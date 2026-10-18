# Рев'ю структури модуля `reminders`

Прочитано: SKILL onion-architecture, `references/audit.md`, порт `GitHubClient` (`server/src/vendor/shared/adapters.ts:151-177`), `adapters/mocks.ts`, `platform/container.ts`. Файли модуля: `routes.ts`, `service.ts`, `repository.ts` (шлях `.../fixtures/reminders-port-gap/server/src/modules/reminders/`). `arch:check` на фікстурі не запускався, висновки з читання коду.

Загалом: напрямок імпортів правильний (service не імпортує drizzle, fastify чи адаптер, репозиторій приймається як `Pick<>`, `now` інжектиться). Проблеми в портах, конструюванні, N+1 і порядку ефектів.

## Знахідки (за проходами audit.md)

### 1. Імпорти
Порушень немає. `service.ts` імпортує лише типи з `@devdigest/shared` і тип репозиторію. `routes.ts` не імпортує drizzle.

### 2. Конструювання
- **`routes.ts:19`** — `new RemindersRepository(container.db)` у тілі плагіна. Для рівня маршруту це допустимо (конструюється один раз на плагін), але репозиторій працює напряму з `container.db`. Структурно не блокер, краще брати репозиторій з контейнера (`container.remindersRepo`) або лишити як є за домовленістю інших модулів.
- **`routes.ts:20`** — `github: async () => (await container.github()) as ... & PrLabeler`. Це касту, що приховує дірку в порті (див. п.3).

### 3. Порти (БЛОКЕР за структурою)
- **`service.ts:4-7`, `service.ts:47`, `service.ts:49`** — сервіс викликає `addLabel` і `requestReviewers`, яких **немає** в порті `GitHubClient` (`adapters.ts:151-177`; там лише `currentLogin`, `postReview` тощо). Не існують вони ні в `adapters/github/octokit.ts`, ні в `adapters/mocks.ts` (grep знаходить лише `currentLogin`). Локальний інтерфейс `PrLabeler` оголошено в service, а на `routes.ts:20` його «приклеєно» кастом `as ... & PrLabeler`. Тип-перевірка проходить, але в рантаймі `OctokitGitHubClient` не має цих методів, тож `gh.addLabel is not a function` при першому ж виклику. Тести з `adapters/mocks.ts` теж не зможуть це підставити.
- Порт-інтерфейс, оголошений у шарі application (`PrLabeler`), — це обхід: порти живуть у core (`vendor/shared/adapters.ts`).

### 4. Тенантність
Гаразд: `listStalePulls` (`repository.ts:28`), `getRepo` (`:39`), `countFindings` (`:47-48`, через join на `reviews`) приймають `workspaceId`.

### 5. Записи та порядок ефектів
- **`service.ts:47-50`** — два зовнішні виклики підряд (`addLabel`, потім `requestReviewers`) без жодного стану й ідемпотентності. Якщо другий впаде, PR вже позначено, але автора не запрошено, і повторний запуск знову ставить мітку й знову запитує рев'юера (повторні нагадування). Жодного маркера «вже нагадували», тож щоразу, коли cron/клієнт викликає `/reminders/nudge`, ті самі PR отримують те саме. Потрібно: перевіряти наявність мітки перед дією або зберігати факт нагадування, і зробити кроки безпечними для повтору. Транзакція тут не потрібна (в БД нічого не пишеться), і не тримати її відкритою над викликами.
- Один збій на PR перериває весь цикл (немає обробки помилки на рівні елемента), тож частина PR оброблена, частина ні, а відповідь не повертається.

### 6. Запити в циклі (N+1)
- **`service.ts:36`** — `repo.getRepo` на кожен PR у циклі.
- **`service.ts:41`** — `repo.countFindings` на кожен PR у циклі; до того ж `repository.ts:44-49` рахує через `select id ... rows.length` (тягне всі рядки замість `count()`).
- **`service.ts:47-49`** — мережеві виклики GitHub у циклі (послідовні; для них прийнятно, але див. п.5).
- Виправлення: у репозиторії один метод, що повертає застарілі PR одразу з `owner/name` (join на `repos`) і кількістю знахідок (groupBy/`count()`), або приймає список id і повертає групами.

### 7. Вихід
Гаразд: на маршруті є `response: { 200: NudgeResponse }` (`routes.ts:8,24`), повертаються лише лічильники. Незначно: `NudgeResponse` дублює `ReminderResult` у `service.ts:15`; допустимо, поки схема потрібна лише цьому маршруту.

### Другорядне
- `service.ts:20-21` — `STALE_AFTER_DAYS` і `LABEL` варто винести у `constants.ts` модуля (ring domain), а обчислення cutoff — в чисту функцію з юніт-тестом.
- `routes.ts:24` — POST без тіла змінює зовнішній стан; перевірте, що авторизація/rate-limit покривають маршрут.
- `repository.ts:35` — `getRepo` повертає `row | undefined` без явного типу; краще явний тип результату.

## Що блокує мерж
1. Відсутні методи `addLabel` / `requestReviewers` на порті (і в адаптері, і в моку) — код зламаний у рантаймі, а каст на `routes.ts:20` це маскує.
2. Небезпечний порядок ефектів та відсутність ідемпотентності (спам нагадувань).

Решта (N+1, константи, count()) — структура/продуктивність.

## Впорядкований план виправлення (кожен крок залишає `pnpm arch:check` зеленим)
1. **Порт.** У `server/src/vendor/shared/adapters.ts` додати до `GitHubClient` use-case-методи без типів SDK: `addLabel(repo, n, label): Promise<void>` і `requestReviewers(repo, n, logins): Promise<void>` (за потреби ще `listLabels`/`getPullLabels` для перевірки «вже позначено»). Перевірити дзеркальну копію контрактів у `client/src/vendor/shared` (за правилом з кореневого CLAUDE.md).
2. **Адаптер.** Реалізувати їх у `server/src/adapters/github/octokit.ts` (`issues.addLabels`, `pulls.requestReviewers`).
3. **Мок.** Додати методи в `server/src/adapters/mocks.ts`, щоб сервіс можна було тестувати без мережі.
4. **Сервіс.** У `service.ts` видалити `PrLabeler`, типізувати `github: () => Promise<Pick<GitHubClient, 'currentLogin' | 'addLabel' | 'requestReviewers'>>`.
5. **Маршрут.** У `routes.ts:20` прибрати каст: `github: () => container.github()`.
6. **Репозиторій без N+1.** Замінити `listStalePulls` + `getRepo` + `countFindings` одним методом (`listStalePullsWithFindings(workspaceId, olderThan)`: join `repos`, `count()` по `findings`→`reviews` з `groupBy`, фільтр `findings > 0`), що повертає контрактний тип. Лічильник `skipped` тоді рахується як `totalStale - candidates` або окремим запитом.
7. **Порядок ефектів.** У сервісі: спочатку перевірити, чи мітка вже є (пропустити PR), потім `addLabel`, потім `requestReviewers`; обробляти помилку на рівні PR (try/catch з підрахунком `failed`, без проковтування), щоб повторний запуск доробляв залишок. Без транзакції навколо зовнішніх викликів.
8. **Домен.** Винести `STALE_AFTER_DAYS`/`LABEL` у `constants.ts`, обчислення cutoff у чисту функцію; додати юніт-тест сервісу з fake `Deps` (мок GitHub), що перевіряє: нема знахідок — пропуск; автор = me — без запиту рев'юера; повторний запуск не дублює.
9. **Перевірка.** `cd server && pnpm typecheck && pnpm test && pnpm arch:check`; базлайн не чіпати (`pnpm arch:baseline` лише якщо зникли старі порушення).
