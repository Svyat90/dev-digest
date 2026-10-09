# Рев'ю модуля `reminders` (перед мержем)

Прочитано: `server/CLAUDE.md`-конвенція через SKILL, `references/audit.md`, порт `GitHubClient` у `server/src/vendor/shared/adapters.ts:151-177`. Проходи аудиту: імпорти, конструювання, порти, тенантність, записи, запити, вихід.

Шляхи нижче відносно `server/src/modules/reminders/`.

## Проблеми

### 1. Імпорти (кільця)
- **service.ts:1, :7** — застосунковий шар імпортує конкретний `OctokitGitHubClient` (типом) і залежить від нього в `RemindersDeps.github`. Правило `no-concrete-adapters-in-modules` / залежність тільки досередини (type-only імпорти теж рахуються). Структурна, але веде до проблеми №3.
- **routes.ts:4, :17** — презентаційний шар імпортує адаптер і робить `as OctokitGitHubClient` (звуження `GitHubClient` до конкретного класу). Те саме правило; приховує справжню проблему порту.
- **helpers.ts:1** — "domain" файл (`helpers.ts`) імпортує типи з `repository.ts` (інфраструктура). Домен не має знати інфраструктуру; `StalePull` треба винести в контракт/доменний тип (`PullContext` вже тут).
- **helpers.ts:16-26** — `loadPullContext` робить I/O (репозиторій), хоча лежить у файлі чистих функцій. Порушує `domain-is-pure`; це оркестрація, її місце в `service.ts`.

### 2. Конструювання
- **routes.ts:16** — `new RemindersRepository(container.db)` у маршруті, а в `routes.ts:15-19` складається весь граф залежностей. Маршрут не повинен торкатися `container.db`; конструювання має жити в композиційному корені (`platform/container.ts`, напр. `container.remindersRepo`), а маршрут бере готову залежність.
- **routes.ts:18** — `now: () => new Date()` допустимо як інʼєкція, але разом з пунктом вище підтверджує, що маршрут виконує роль composition root.

### 3. Порти — метод має існувати (БЛОКЕР)
- **service.ts:24** — `gh.addLabels(...)` і **service.ts:25** — `gh.requestReviewers(...)`: цих методів **немає** в порту `GitHubClient` (`vendor/shared/adapters.ts:151-177`) і, за grep, немає в `adapters/github/octokit.ts` та `adapters/mocks.ts`. Код спирається на конкретний адаптер через каст (routes.ts:17), тож це не скомпілюється/впаде в рантаймі. `currentLogin` (service.ts:18) в порту є — ок.
- Виправлення в порядку: додати метод(и) у порт (use-case форма, без типів SDK, напр. `labelAndRequestReview(repo, n, ...)` або два окремі) -> реалізувати в `octokit.ts` -> додати в `adapters/mocks.ts`.

### 4. Тенантність
- Репозиторій скоупить усе по `workspaceId`: `repository.ts:28` (pull_requests), `:39` (repos), `:48` (findings через join на reviews). Проблем немає.

### 5. Записи / порядок ефектів (БЛОКЕР за даними)
- **service.ts:23-26** — цикл `await addLabels` -> `await requestReviewers` без стану "що вже зроблено": якщо впаде посередині, частина PR отримала мітку, але не рев'юера, і повторний запуск знову нудж­итиме тих самих (немає ідемпотентності, немає запису "nudged"). Також при падінні на PR №k решта не оброблена, а відповідь не повертається. Потрібно: зберігати стан (напр. таблиця/колонка `nudged_at`) і писати його правильно, перевіряти вже виконане (наявність мітки) перед викликом, обробляти помилки по PR і рахувати `failed`. Транзакцію через виклик зовнішнього порту не тримати.
- **service.ts:25** — `requestReviewers(..., [ctx.pull.author])`: просить автора рев'юити власний PR; GitHub відхиляє це (422). Схоже на логічну помилку (мав би бути рев'юер, а не автор); `needsNudge` (helpers.ts:29) також виключає лише `author !== me`. Уточнити задум.

### 6. Запити в циклах (N+1)
- **service.ts:20** + **helpers.ts:21-24** — для кожного stale PR по 2 запити (`getRepo`, `countFindings`) у `Promise.all(pulls.map(...))`: 2N запитів, `getRepo` для одного й того ж репозиторію повторюється. Винести в репозиторій один метод `listStalePullsWithContext(workspaceId, olderThan)` (join на repos + `count`/`groupBy` по findings) або `getReposByIds` + `countFindingsByPrIds`. Це лише зміна репозиторію, кільця не міняються.
- **repository.ts:43-50** — `countFindings` вибирає всі рядки й рахує `rows.length` на клієнті; треба `count()` в SQL (Drizzle: `count()` повертає number).

### 7. Вихід
- **routes.ts:9, :21** — відповідь має схему `NudgeResponse`; ок. `StalePull` з repository.ts:5-11 — локальний тип репозиторію, що виходить у домен (див. п. 1).
- **repository.ts:35-41** — `getRepo` не має явного типу повернення (повертає `row | undefined`); додати тип.

## Класифікація
- **Блокери:** п.3 (методи відсутні в порту — код не працює / обходить порт), п.5 (неідемпотентний цикл з частковим станом; автор як рев'юер).
- **Структура:** п.1, п.2, п.6 (N+1 — також продуктивність), решта.
- Баланс `arch:check`: пункти п.1/п.2 нові порушення; базову лінію (`.dependency-cruiser-known-violations.json`) не регенерувати.

## Впорядкований план виправлення (кожен крок лишає `pnpm arch:check` зеленим)
1. **Порт:** додати в `GitHubClient` (`vendor/shared/adapters.ts`) методи для мітки й запиту рев'ю (use-case форма), реалізувати в `adapters/github/octokit.ts`, додати у `adapters/mocks.ts`. Усунути питання "автор як рев'юер".
2. **Сервіс:** у `service.ts` та `RemindersDeps` замінити `OctokitGitHubClient` на `GitHubClient`; прибрати імпорт адаптера (service.ts:1) і каст у routes.ts:4/:17 (`github: () => container.github()`).
3. **Конструювання:** створити `RemindersRepository` у контейнері (`container.remindersRepo`) або фабриці модуля; з `routes.ts` прибрати `new RemindersRepository(container.db)` і доступ до `container.db`.
4. **Домен:** у `helpers.ts` залишити чисті `cutoffFor`, `needsNudge`, константи; `loadPullContext` перенести в сервіс (або видалити після кроку 5); тип `StalePull` перенести в контракт/доменний тип, щоб `helpers.ts` не імпортував `repository.ts`.
5. **N+1:** один запит у репозиторії (join repos + агрегат findings через `count()`), що повертає готові `PullContext`; прибрати `Promise.all(map)` із service.ts:20; `countFindings` -> SQL `count()`.
6. **Безпечні ефекти:** зафіксувати стан "nudged" до/після виклику (`pending`/`nudged_at`), ідемпотентна перевірка (мітка вже є -> пропуск), обробка помилок по PR з лічильником `failed`; без транзакції навколо виклику GitHub.
7. **Тести:** юніт-тест `needsNudge`/`cutoffFor` (без БД); тест сервісу з `adapters/mocks.ts` і fake deps (перевірити, що виклики йдуть через порт і повторний запуск ідемпотентний); `*.it.test.ts` для нового запиту репозиторію.
8. **Перевірка:** `cd server && pnpm typecheck && pnpm test && pnpm arch:check`.
