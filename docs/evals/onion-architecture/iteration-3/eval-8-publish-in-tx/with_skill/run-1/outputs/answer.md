# Дубль review у GitHub: модуль publish

Прочитано: `onion-architecture/SKILL.md`, `references/transactions.md`, `references/audit.md` (прохід 5 «Writes»), а також `service.ts`, `repository.ts` і `routes.ts` модуля publish.

## Причина

Транзакція тут не захищає від дубля, вона його створює. GitHub не входить у транзакцію, тож її відкат не скасовує відправлений review.

1. `service.ts`, `publish()`: `gh.postReview` викликається всередині `uow.run`, між `insertPending` і `markSent`. Це порушує правило: зовнішній порт не можна викликати всередині транзакції.
   - Якщо `markSent` або commit падає (таймаут, розрив з'єднання), відкочується і рядок `pending`.
   - Review при цьому вже є на GitHub.
   - У БД не лишається жодного сліду відправки, тому `retryPending` його не бачить.
   - Клієнт повторює запит, `postReview` викликається вдруге, і review дублюється.
   - Довга транзакція ще й тримає з'єднання з пулу на час HTTP-запиту.
2. `retryPending()`: `postReview`, потім `markSent` без транзакції і без ідемпотентності.
   - Якщо `markSent` впав, рядок лишається `pending`, і наступний retry відправить review ще раз.
   - Два паралельні `POST /publish/retry` обидва вибирають ті самі `pending` і обидва постять. Рядок ніхто не «захоплює».
3. Дрібніше (прохід 6 «Queries»): у циклі по рядках на кожному кроці викликаються `getPull` (N+1) і `this.deps.github()`. Їх треба винести з циклу або зробити пакетним запитом.

Шари тут дотримані: `UnitOfWork` і `TxScope` на місці, репозиторій використовує `executor(db, tx)`, `workspaceId` скрізь передається. Проблема в порядку ефектів, а не в залежностях між шарами.

## Виправлення

Принцип: стан «pending» пишемо до виклику, у власній короткій транзакції. Сам виклик GitHub робимо поза транзакцією. Результат записуємо після нього. Повтор має бути безпечним: атомарне захоплення рядка і ключ ідемпотентності.

```ts
// service.ts
async publish(workspaceId: string, prId: string, body: string) {
  const { repo } = this.deps;
  const pull = await repo.getPull(workspaceId, prId);
  if (!pull) throw new NotFoundError('Pull request not found');

  // 1) Durable intent, committed BEFORE the external call (single statement, no tx needed).
  const pending = await repo.insertPending(workspaceId, prId, body);

  // 2) External call OUTSIDE any transaction.
  return this.send(workspaceId, pending.id, pull, body);
}

private async send(workspaceId: string, id: string, pull: PullRef, body: string) {
  const gh = await this.deps.github();
  const review = await gh.postReview({ owner: pull.owner, name: pull.name }, pull.number, {
    body: `${body}\n\n<!-- devdigest:publication:${id} -->`, // idempotency marker
    event: 'COMMENT',
    comments: [],
  });
  return this.deps.repo.markSent(workspaceId, id, review.id);
}

async retryPending(workspaceId: string) {
  const { repo } = this.deps;
  const pending = await repo.claimPending(workspaceId); // one query, atomically claims rows
  const pulls = await repo.getPulls(workspaceId, pending.map((p) => p.prId)); // no N+1
  let sent = 0;
  for (const p of pending) {
    const pull = pulls.get(p.prId);
    if (!pull) continue;
    await this.send(workspaceId, p.id, pull, p.body);
    sent++;
  }
  return { sent };
}
```

```ts
// repository.ts: atomic claim, so concurrent retries do not pick up the same rows
async claimPending(workspaceId: string) {
  // UPDATE publications SET status='sending', claimed_at=now()
  // WHERE id IN (SELECT id FROM publications WHERE workspace_id=$1 AND
  //   (status='pending' OR (status='sending' AND claimed_at < now() - interval '5 min'))
  //   FOR UPDATE SKIP LOCKED) RETURNING *
}
```

- Додати статус `sending` (і колонку `claimed_at`) до `publications`. Це міграція через `pnpm db:generate`. Тоді одночасний retry не візьме ті самі рядки, а завислий `sending` можна повторно захопити після таймауту.
- Ідемпотентність на боці GitHub: маркер `publication:<id>` у тілі review. Перед повторною відправкою `send` має запитати наявні review цього PR і шукати маркер. Для цього потрібен метод `listReviews` у порту `GitHubClient` (`vendor/shared/adapters.ts`), реалізація в адаптері та мок у `adapters/mocks.ts`. Перевірте, чи порт уже має такий метод, а не покладайтеся на виклик, якого в порту немає.
- `uow` зі `PublishDeps` можна прибрати: у цьому use case немає багатотабличного запису, який треба робити атомарно. Якщо з'явиться, транзакція має охоплювати лише записи, без `postReview`.

## Тести

- Юніт: фейковий `github.postReview`, що кидає виняток або успішний, а `markSent` падає. Перевірити, що рядок лишився `pending`/`sending`, а повторний `retryPending` не постить вдруге (знаходить маркер).
- `*.it.test.ts`: два паралельні `claimPending` не повертають однакові рядки.

## Блокери та структура

- Блокери (хибні дані): пункти 1 і 2 вище.
- Лише структура: N+1 у `retryPending`.
- Після змін запустити `pnpm arch:check` у `server/`. Нових порушень шарів бути не повинно, baseline не чіпати.
