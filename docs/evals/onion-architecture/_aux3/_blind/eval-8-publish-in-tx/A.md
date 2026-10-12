# Дублі review у GitHub: модуль `publish`

## Причина
Транзакція не може охопити GitHub. Вона дає атомарність тільки для Postgres. `postReview` — зовнішній, незворотний побічний ефект.

1. **`PublishService.publish` викликає `gh.postReview` всередині `uow.run`.** Це порушує правило з секції 6 скіла: жодного виклику зовнішнього порту всередині транзакції.
   - Якщо після успішного `postReview` падає `markSent` або `COMMIT` (таймаут, обрив з'єднання), транзакція відкочується. Рядок `pending` зникає, а review у GitHub залишається.
   - БД про цей review не знає. Користувач бачить помилку, натискає «publish» ще раз, і виходить дубль.
   - Транзакція ще й тримає з'єднання з пулу на час HTTP-запиту.
2. **`retryPending` не має ні транзакції, ні захисту від конкурентності.**
   - Якщо `postReview` пройшов, а `markSent` упав, рядок лишається `pending`. Наступний retry постить той самий review ще раз.
   - Два паралельні `/publish/retry` (або retry разом із ручним публішем) обидва прочитають той самий `pending` через `listPending` і обидва запостять.
   - Немає атомарного «захоплення» рядка і немає ідемпотентного ключа.

Репозиторій написаний правильно: `insertPending` і `markSent` приймають `tx` і йдуть через `executor`. Помилка в сервісі, а не в репозиторії.

## Виправлення
Правило: спочатку зафіксувати намір у БД (commit), потім зробити зовнішній виклик, потім зафіксувати результат. Дубль у GitHub не відкочується, тому його треба запобігати, а не відкочувати.

**Сервіс** (зовнішній виклик поза транзакцією):

```ts
async publish(workspaceId, prId, body) {
  const { repo } = this.deps;
  const pull = await repo.getPull(workspaceId, prId);
  if (!pull) throw new NotFoundError('Pull request not found');

  const pending = await repo.insertPending(workspaceId, prId, body);   // autocommit: намір зафіксовано
  return this.send(workspaceId, pull, pending.id, body);
}

private async send(workspaceId, pull, id, body) {
  const { repo } = this.deps;
  // атомарне захоплення: тільки один виклик виграє
  const claimed = await repo.claimPending(workspaceId, id);            // pending -> sending
  if (!claimed) return null;                                           // хтось інший уже шле
  const gh = await this.deps.github();
  const review = await gh.postReview({ owner: pull.owner, name: pull.name }, pull.number,
    { body: marker(id) + body, event: 'COMMENT', comments: [] });      // поза транзакцією
  return repo.markSent(workspaceId, id, review.id);                    // один UPDATE
}
```

`retryPending` викликає той самий `send` для кожного рядка.

**Репозиторій:** додати `claimPending` — один атомарний
`UPDATE publications SET status='sending' WHERE id=$1 AND workspace_id=$2 AND status='pending' RETURNING *`.
Якщо повернувся 0 рядків, інший воркер уже захопив запис.

- Додати статус `'sending'` у схему та `PublicationDto`. Тип `pending|sent` у DTO і в zod-схемі треба розширити, або тримати окреме поле `claimedAt`.
- `listPending` у retry має також підхоплювати «завислі» `sending` старші за N хвилин. Це чесний at-least-once з ризиком дубля тільки в вікні падіння між `postReview` і `markSent`.

**Закрити останнє вікно.**
- Вставляти в тіло review прихований маркер `<!-- devdigest:publication:<id> -->`.
- Перед повторною відправкою `sending`-запису перевіряти через порт `GitHubClient` (додати метод на кшталт `listReviews`, новий порт іде в `vendor/shared/adapters.ts` і в `adapters/mocks.ts`), чи review з таким маркером уже є. Якщо є, зробити лише `markSent`.

`UnitOfWork` у `publish` після цього не потрібен. Кожна операція — один оператор, і транзакція нічого не дає. `uow` можна прибрати з `PublishDeps`. Транзакція потрібна, лише якщо `markSent` стане частиною multi-table запису.

## Тести
- Юніт сервісу з fake-ами: `postReview` кидає виняток, рядок лишається `pending`/`sending`, а повторний виклик не плодить другий review.
- `*.it.test.ts` для `claimPending`: два паралельні виклики, виграє один.
- `arch:check` не зачіпається: сервіс не імпортує drizzle, `claimPending` живе в репозиторії.
