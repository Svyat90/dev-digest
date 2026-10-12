# Дублікати review у GitHub: модуль `publish`

Прочитано: `SKILL.md`, `references/audit.md`, `references/transactions.md`, порт `GitHubClient` у `vendor/shared/adapters.ts` і три файли модуля. Я не запускав `arch:check` і не писав тестів. Висновки зроблено з коду.

## Причина (блокер, pass 5 «Writes»)

Транзакція атомарна лише для БД. Виклик GitHub у неї не входить.

**`service.ts:21-29`, `publish()`.** `gh.postReview` викликається всередині `uow.run`, між `insertPending` і `markSent`.
- Якщо `markSent` або commit падає, відкочується вся транзакція, разом із рядком `pending`.
- Review на GitHub уже опубліковано, а в БД про нього немає жодного сліду.
- Користувач повторює запит і отримує другий review.
- Це ще й порушує правило SKILL §6: не викликати зовнішній порт усередині транзакції. Утримується з'єднання з пулу на час HTTP-виклику.

**`service.ts:32-49`, `retryPending()`.** Тут транзакції немає взагалі.
- Порядок такий: `postReview`, потім `markSent` поза `tx`. Якщо `markSent` падає або процес помирає, рядок лишається `pending`, а review уже на GitHub. Наступний retry публікує його вдруге.
- Два паралельних `POST /publish/retry` читають один і той самий `listPending` і обидва постять.
- Ідемпотентності немає ніде: ні ключа, ні перевірки вже надісланого, ні «захоплення» рядка.

## Що ще не так

- `service.ts:36-39`: N+1. `repo.getPull` і `this.deps.github()` викликаються в циклі (pass 6).
- `repository.ts:57`: `listPending` не вміє блокувати чи захоплювати рядки.
- Структурно (імпорти, конструкція, tenancy, вихід) усе гаразд:
  - сервіс отримує вузькі `Deps` і `UnitOfWork`, а не `Container`;
  - `workspaceId` скрізь на місці;
  - на виході DTO зі схемою відповіді.
- Нова вимога: GitHub не має idempotency key для review, тому потрібна перевірка «чи вже надіслано».

## Виправлення (порядок: кожен крок лишає `arch:check` зеленим)

1. **Порт (`vendor/shared/adapters.ts`).**
   - Додати use-case метод, наприклад `findReviewByMarker(repo, n, marker): Promise<{ id: string } | null>`. У сигнатурі без типів SDK.
   - Реалізувати його в GitHub-адаптері й додати в `adapters/mocks.ts`.
   - Це потрібно, бо порт зараз не вміє показати вже опубліковані review.
2. **Repository.**
   - `claimPending(workspaceId, id)`: `UPDATE … SET status='sending' WHERE id=? AND status='pending' RETURNING …`. Це атомарне захоплення, другий конкурент отримає 0 рядків.
   - Додати стан `sending` до схеми й DTO. Це зміна схеми, тож потрібна міграція: `pnpm db:generate`, без ручного редагування `migrations/**`.
   - Додати `getPullsByIds(workspaceId, ids)` або повертати `owner/name/number` одним join-запитом з `listPending`, щоб прибрати N+1.
3. **Service: порядок «write → call → write», без транзакції навколо виклику.**
   ```ts
   async publish(workspaceId, prId, body) {
     const pull = await repo.getPull(workspaceId, prId);
     if (!pull) throw new NotFoundError('Pull request not found');
     const pending = await repo.insertPending(workspaceId, prId, body); // окремий коміт
     return this.send(workspaceId, pull, pending.id, body);
   }

   private async send(workspaceId, pull, id, body) {
     const marker = `<!-- devdigest-publication:${id} -->`;
     const gh = await this.deps.github();
     const existing = await gh.findReviewByMarker(ref, pull.number, marker); // ідемпотентність
     const reviewId =
       existing?.id ??
       (await gh.postReview(ref, pull.number, { body: `${body}\n${marker}`, event: 'COMMENT', comments: [] })).id;
     return repo.markSent(workspaceId, id, reviewId);
   }
   ```
   - Якщо після `postReview` впаде `markSent`, рядок лишається `pending`.
   - Retry знайде review за маркером і лише дозапише `sent`, а не запостить знову.
   - `UnitOfWork` тут більше не потрібен: це один `UPDATE`. Якщо з'явиться другий запис для одного use case (наприклад, лог або статус PR), `markSent` + він мають іти в короткому `uow.run` вже після виклику GitHub.
4. **`retryPending`.**
   - Для кожного `pending` викликати `claimPending`; якщо рядок не захоплено, пропустити.
   - Далі йти через той самий `send`. Один `gh = await github()` і мапа pull-ів винести з циклу.
   - Рядки в `sending`, що застрягли довше таймауту, повертати в `pending` або розбирати окремим кроком. Якщо процес помер між `claim` і `postReview`, без цього вони зависнуть.
5. **Тести.**
   - Unit з фейковим `GitHubClient`: `markSent` кидає помилку, повторний виклик не викликає `postReview` вдруге, бо `findReviewByMarker` повертає знайдений review.
   - Тест на конкуренцію: два `claimPending` на один id, другий повертає null.
   - `*.it.test.ts` для атомарності `claimPending` на реальному Postgres.

## Підсумок

«Усе в транзакції» не рятує, бо GitHub не входить у транзакцію. Rollback стирає запис про вже надісланий review (`publish`), а retry без `claim` і без перевірки існуючого review постить повторно (`retryPending`). Виправлення: комітити `pending` до виклику, викликати GitHub поза транзакцією, робити виклик ідемпотентним через маркер у тілі з перевіркою через новий метод порту, захоплювати рядки атомарно і прибрати N+1.
