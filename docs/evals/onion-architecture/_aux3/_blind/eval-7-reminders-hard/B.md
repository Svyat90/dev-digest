# Рев'ю структури модуля `reminders` (onion)

Базові файли: `server/src/modules/reminders/{routes,service,helpers,repository}.ts` у fixtures. Це логіка з оркестрацією (БД + GitHub), тому сервіс виправданий, а проблема лише в напрямку залежностей. Перевірки `pnpm arch:check` на фікстурі я не запускав. Правила нижче наведено за SKILL.md і `.dependency-cruiser.cjs`.

## Проблеми

1. **`service.ts:1, :7` (застосунок залежить від конкретного адаптера).** Сервіс імпортує `OctokitGitHubClient` з `adapters/github/octokit.js`. Це порушує `no-concrete-adapters-in-modules` і правило залежностей: application не знає про `adapters/**`. Сервіс має залежати від порту `GitHubClient` з `vendor/shared/adapters.ts`.
2. **`routes.ts:4, :17` (презентація знає адаптер, `as`-cast).** `container.github()` приведено до `OctokitGitHubClient`. Причина в тому, що порт `GitHubClient` не має методів `addLabels` і `requestReviewers` (є лише `currentLogin` тощо, `adapters.ts:151-177`), а сервіс викликає їх на `service.ts:24-25`. Cast приховує пропуск у порту, замість того щоб додати метод.
3. **`helpers.ts:1` (domain імпортує infrastructure).** Чисте доменне ядро (`domain-is-pure`) імпортує тип з `./repository.js` (`RemindersRepository`, `StalePull`). Domain може знати лише контракти. `StalePull` і `PullContext` треба оголосити в domain або контрактах, а не в репозиторії.
4. **`helpers.ts:16-26` (I/O в domain-файлі).** `loadPullContext` async і викликає `repo.getRepo`/`repo.countFindings`. Це оркестрація (load), а не чисте правило. Її місце в `service.ts`. У `helpers.ts` мають лишитися `cutoffFor`, `needsNudge`, константи, які тестуються без БД.
5. **`routes.ts:15-19` (збирання залежностей у route).** Route створює `new RemindersRepository(container.db)` і лямбду для GitHub. Складання належить composition side: `container.remindersRepo` або фабрика Deps у `platform/container.ts`. Route лише викликає сервіс.
6. **`service.ts:20` + `repository.ts:35-50` (N+1 і недбалий запит).** Для кожного PR виконуються 2 запити (`getRepo`, `countFindings`), а `countFindings` (`repository.ts:44-49`) вибирає всі рядки й бере `rows.length` замість `count()`. Агрегація має жити в репозиторії: один метод, що повертає stale PR разом з repo і лічильником (join + `count()`, scope за `workspaceId` зберегти). Тоді `loadPullContext` не потрібна.
7. **`service.ts:24-25` (надійність).** Використано `ctx.repo!` (non-null assertion, хоча `needsNudge` це гарантує лише неявно), а цикл послідовно робить два зовнішні виклики. Часткова відмова посеред циклу лишає неузгоджений результат. Це не транзакція БД, але варто рахувати помилки й повертати їх у відповіді, а не падати. Рівень низький.

Що в порядку: `repository.ts` скоупить усе за `workspaceId` (findings через join на reviews), сервіс має вузький `Deps` з `Pick<>` і інʼєктований `now`, route тонкий за формою.

## Впорядкований план виправлення (кожен крок залишає `arch:check` зеленим)

1. **Порт.** У `vendor/shared/adapters.ts` додати до `GitHubClient` методи `addLabels(repo, n, labels)` і `requestReviewers(repo, n, logins)`. Реалізувати в `adapters/github/octokit.ts`, додати в мок у `adapters/mocks.ts`. Також продублювати зміну в `client/src/vendor/shared` лише якщо типи там використовуються (перевірити).
2. **Сервіс.** У `service.ts` замінити `OctokitGitHubClient` на `GitHubClient`. У `routes.ts` прибрати імпорт адаптера і cast.
3. **Типи в domain.** Перенести `StalePull` і `PullContext` з `repository.ts`/`helpers.ts` у domain-файл модуля (або контракт). `helpers.ts` більше не імпортує `./repository.js`; `repository.ts` імпортує тип звідти.
4. **Витягнути I/O з helpers.** `loadPullContext` перенести в `service.ts` (або видалити за кроком 5). У `helpers.ts` залишити `cutoffFor`, `needsNudge`, `STALE_AFTER_DAYS`, `LABEL`.
5. **Репозиторій.** Замінити `getRepo` + `countFindings` одним запитом `listStalePulls` з repo (owner/name) і `count()`. Прибрати N+1, оновити `Pick<>` у `RemindersDeps`, прибрати `!`.
6. **Composition.** Винести створення `RemindersRepository` і `RemindersDeps` у `platform/container.ts` (lazy getter + `ContainerOverrides`), у route лишити `new RemindersService(container.remindersDeps())`.
7. **Тести.** Unit-тести без БД для `cutoffFor`/`needsNudge`; unit-тест сервісу з fake `Deps` і `MockGitHubClient` (випадок частково невдалого виклику); один `.it.test.ts` для запиту з join/count і ізоляції по `workspaceId`.
8. **Перевірка.** `cd server && pnpm typecheck && pnpm test && pnpm arch:check`; baseline не змінювати.
