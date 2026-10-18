# digest-publish: причина дубля/«фантомної» доставки, структура, виправлення

Прочитано: `SKILL.md` (onion-architecture, розділи 3–6, 11) та `references/transactions.md`. Код модуля: `routes.ts`, `service.ts`, `repository.ts`. `arch:check` і тести не запускались (фікстура).

## 1. Причина (порядок побічних ефектів у `DigestPublishService.publish`)

Послідовність зараз:

1. LLM-виклик.
2. `repo.insert(...)` одразу пише рядок з `deliveredTo = owner/name#number`. Для решти системи це вже «доставлено».
3. `gh.postReview(...)`, зовнішній виклик.
4. `repo.finish(...)` ставить `periodEnd`.

Це два симптоми однієї помилки: запис «доставлено» робиться ДО доставки, а доставка не ідемпотентна.

- **«У БД доставлено, а коментаря немає».** Якщо `postReview` падає (rate limit, 5xx, таймаут, токен), рядок із `deliveredTo` уже закомічений. Нічого його не відкочує і не позначає як failed.
- **«При повторі два коментарі».** Є два шляхи:
  - Коментар опублікований, але `finish` або мережа після нього впали (чи клієнт отримав таймаут, хоча GitHub прийняв запит). Користувач повторює запит.
  - Кожен виклик `publish` без жодної перевірки створює новий рядок `digests` і новий коментар. Ключа ідемпотентності немає: ні унікального обмеження, ні перевірки «для цього PR уже є дайджест», ні маркера в тілі коментаря.

Окремо: `insert` + `finish` — два записи одного use case, і між ними зовнішній виклик. У транзакцію їх обгорнути не можна, бо за скілом (розділ 6) зовнішній порт не викликають усередині транзакції. Тому потрібен явний стан (outbox), а не `db.transaction`.

## 2. Що ще не так зі структурою

1. **Немає стану дайджесту.** «Доставлений» виводиться з того, що `deliveredTo` заповнене, а `periodEnd` використовується як «завершено». Це перевантаження полів, і через нього помилку не видно. Потрібне явне `status` (`pending | delivered | failed`) і `deliveredTo` лише після успіху. Це зміна схеми, тому потрібна drizzle-міграція, згенерована `pnpm db:generate` (вручну `db/migrations/**` не чіпати). Якщо міграцію зараз не можна, мінімум: `deliveredTo = null` на insert, заповнювати його в `markDelivered`, а «в процесі» = `deliveredTo IS NULL`.
2. **Правило пише зовнішній виклик, а не домен.** Промпт, назва моделі `'claude-haiku-5-5'`, склеювання `title + body` і `'anthropic'` в `routes.ts` — це хардкод у сервісі та роуті. Правило «як будується запит на summary» і «як будується тіло коментаря (з маркером)» має бути чистими функціями в `helpers.ts`/`constants.ts` із юніт-тестом без БД. Вибір провайдера і моделі має робити контейнер або конфіг.
3. **Репозиторій повертає сирий `DigestRow`**, а сервіс віддає його назовні як відповідь. Значення, що виходить за межі репозиторію, має бути контрактним DTO (`@devdigest/shared`) з рядка → DTO мапером поруч із репозиторієм. Зараз зміна схеми напряму змінює API.
4. **Композиція в роуті.** `routes.ts` робить `new DigestPublishRepository(container.db)` і сам збирає `Deps`. Роут не повинен знати про `container.db` і конкретний репозиторій (правило `routes-do-not-touch-the-db` у дусі). Збирання `Deps` переноситься до контейнера або фабрики плагіна. Сервіс при цьому вже правильно залежить від вузьких `Deps` (`Pick<...>`), це лишити.
5. **Мінімальні речі.**
   - `insert` ставить `periodStart: new Date()` у репозиторії. Час має передаватись ззовні (чистота, тестованість).
   - `getPull` і `getRepo` — окремі запити. Можна один метод із join, зі scope за `workspaceId` (скоуп уже є, це добре).
   - `IdParams` вже в `_shared`, це добре.
   - Відсутній `UnitOfWork`. Для цього кейсу він не обов'язковий (див. нижче), але якщо `markDelivered` писатиме кілька таблиць, потрібен.

## 3. Виправлення

Принцип (impureim sandwich + outbox): спочатку читання й чиста підготовка, потім намір у БД, потім зовнішній ефект, потім фіксація результату. Зовнішні виклики поза транзакціями.

```ts
async publish(workspaceId: string, prId: string): Promise<DigestDto> {
  const { repo } = this.deps;
  // 1. read
  const pull = await repo.getPull(workspaceId, prId);        if (!pull) throw new NotFoundError(...);
  const repoRow = await repo.getRepo(workspaceId, pull.repoId); if (!repoRow) throw new NotFoundError(...);
  const target = formatTarget(repoRow, pull);                 // pure: 'owner/name#N'

  // 2. ідемпотентність: вже доставлений або в процесі для цього PR + цієї ревізії?
  const existing = await repo.findByTarget(workspaceId, target, pull.headSha);
  if (existing?.status === 'delivered') return existing;      // повтор нічого не постить

  // 3. LLM (зовнішній, поза записом)
  const summary = await (await this.deps.llm()).complete(buildSummaryRequest(pull)); // pure builder

  // 4. намір: pending-рядок (або повторне використання існуючого pending/failed)
  const digest = existing ?? await repo.createPending(workspaceId, { bodyMd: summary.text, target, now: this.deps.clock() });

  // 5. побічний ефект: коментар з маркером ідемпотентності <!-- devdigest-digest:{digest.id} -->
  try {
    await (await this.deps.github()).postReview(ref, pull.number, buildReviewBody(summary.text, digest.id));
  } catch (e) {
    await repo.markFailed(workspaceId, digest.id, errorMessage(e)); // статус видно, повтор безпечний
    throw e;
  }

  // 6. фіксація: тільки тепер deliveredTo/status=delivered
  return repo.markDelivered(workspaceId, digest.id, this.deps.clock());
}
```

Репозиторій: `createPending`, `findByTarget`, `markDelivered`, `markFailed` (замість `insert`/`finish`), усі зі `workspaceId`, повертають DTO. Додати часткове унікальне обмеження на `(workspace_id, target, head_sha)` для не-failed рядків, щоб два паралельні кліки не створили два дайджести.

Залишкове вікно: GitHub прийняв коментар, а `markDelivered` впав. Тоді рядок лишається `pending`, і повтор має знайти існуючий коментар за маркером `devdigest-digest:{id}` (потрібен метод `listComments` у порту `GitHubClient`, `vendor/shared/adapters.ts`, і мок в `adapters/mocks.ts`) і лише позначити доставленим, а не постити вдруге. Без такого порту гарантія лише at-least-once, і це треба прямо задокументувати.

Тести:
- Чисті `buildSummaryRequest` і `buildReviewBody`: юніт-тест без БД.
- Сервіс із фейковими `Deps`: (a) `postReview` кидає, тоді статус `failed`, жодного `delivered`; (b) повтор після `delivered` не викликає `postReview`; (c) повтор після `failed` постить один раз.
- Репозиторій: `*.it.test.ts` на унікальне обмеження.

Порядок кроків (кожен лишає `arch:check` зеленим): (1) статус + міграція; (2) `createPending/markDelivered/markFailed` і зміна порядку в сервісі, це саме виправляє баг; (3) ідемпотентність і маркер; (4) винесення чистих функцій і DTO; (5) прибрати `new Repository(container.db)` з роуту.
