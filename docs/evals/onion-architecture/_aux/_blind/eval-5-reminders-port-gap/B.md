# Рев'ю структури модуля `reminders`

Читав `SKILL.md` (onion-architecture) і `references/examples.md`. Файли: `server/src/modules/reminders/{routes,service,repository}.ts` (фікстура). `arch:check` не запускав, оцінка за кодом.

Загалом: напрямок залежностей майже правильний (route → service → repository, service має вузькі `Deps`, `now` інжектується, репозиторій скоупить по `workspaceId`). Головна проблема: **відсутній порт** для нових операцій GitHub, і через це композиція "протікає" в route.

## Проблеми

1. **Порт-гап: `addLabel` / `requestReviewers` немає в `GitHubClient` (критично).**
   `service.ts:4-7` оголошує `PrLabeler` у самому сервісі. У `vendor/shared/adapters.ts` (де живуть порти) `GitHubClient` має лише `currentLogin`, `postReview` тощо, а `addLabel`/`requestReviewers` не існують ні в порті, ні в `adapters/github/octokit.ts`, ні в `MockGitHubClient`. Порт мусить бути в core (SKILL §2, §4, §11 "New external systems got a port… and a mock"). Інтерфейс, оголошений в application-кільці, нічим не реалізований.
2. **Небезпечний type-cast у route: `routes.ts:20`.**
   `(await container.github()) as … & PrLabeler` каже компілятору, що реальний клієнт має методи, яких у нього немає. Це приховує пункт 1. У рантаймі буде `gh.addLabel is not a function` (або тихо пройде на моках). Касту бути не повинно, типи мають сходитися через порт.
3. **Route конструює інфраструктуру: `routes.ts:19`.**
   `new RemindersRepository(container.db)` у route, а сервіс не CRUD-овий (є правило, два порти DB+GitHub). SKILL §3/§5: композиція належить composition root (`platform/container.ts`, напр. `container.remindersRepo`), route лише викликає сервіс. Також route імпортує конкретний `RemindersRepository` (`routes.ts:5`), хоча для сервісу з логікою він має бачити лише service.
4. **Сервіс залежить від конкретного класу репозиторію: `service.ts:2,10`.**
   `Pick<RemindersRepository, …>` — тип-імпорт application → infrastructure. SKILL допускає "its own repository's *type*", тож це допустимо, але краще оголосити вузький інтерфейс у модулі; низький пріоритет.
5. **Бізнес-правила всередині оркестрації, не чисті: `service.ts:20-21,28,42,48`.**
   Поріг застарілості, "є findings → нагадувати", "не нудити автора, якщо це я" — правила вбудовані в метод з I/O. Винести в чисту функцію (напр. `reminders/helpers.ts`: `staleCutoff(now)`, `shouldNudge(findings, author, me)`) з unit-тестом без БД (SKILL §5 Domain, "impureim sandwich").
6. **N+1 запити в циклі: `service.ts:35-41`.**
   `getRepo` і `countFindings` на кожен PR. Репозиторій має повертати вже з'єднані дані (`listStalePulls` з owner/name і findingsCount одним запитом). Це інфраструктурна відповідальність (SKILL §5 Infrastructure).
7. **`countFindings` вантажить усі рядки: `repository.ts:43-50`.**
   `select id … rows.length` замість `count()`. Скоуп по `workspaceId` через join на `reviews` правильний, але агрегат слід робити в SQL.
8. **Репозиторій віддає сирі форми, `getRepo` без типу: `repository.ts:35-41`.**
   Повертає неявний тип рядка (`row | undefined`), а не контрактний `RepoRef`. Для `listStalePulls` `StalePull` ок, але `getRepo` слід типізувати як `RepoRef | undefined`.
9. **Нема помилки/транзакційного захисту при частковому збої: `service.ts:47-50`.**
   Зовнішні виклики GitHub у циклі без обробки: збій на N-му PR обірве весь прохід, а вже позначені лишаться без звіту. Це не транзакція (БД не пишемо), але потрібна політика (лічити як `skipped` або кидати `AppError`).
10. **Тести та реєстрація.** Не видно ні unit-тесту сервісу з фейковими `Deps`, ні мока нового методу в `adapters/mocks.ts` (SKILL §8, §11).

## План виправлення (по порядку, кожен крок залишає `arch:check` зеленим)

1. **Порт.** У `server/src/vendor/shared/adapters.ts` додати до `GitHubClient` (або окремий вузький інтерфейс `PrLabeler`) методи `addLabel(repo, n, label)` та `requestReviewers(repo, n, logins)`; назви без деталей Octokit. Видалити `PrLabeler` з `service.ts`.
2. **Адаптер і мок.** Реалізувати в `adapters/github/octokit.ts` (Octokit `issues.addLabels`, `pulls.requestReviewers`) і в `MockGitHubClient` (`adapters/mocks.ts`, із записом викликів). Перевірити клієнтську копію `client/src/vendor/shared`, якщо порт там дзеркалиться.
3. **Прибрати cast.** У `routes.ts:20` передавати `container.github()` без `as`; `RemindersDeps.github` типізувати `() => Promise<GitHubClient>` (або `Pick<GitHubClient, 'currentLogin'|'addLabel'|'requestReviewers'>`).
4. **Чисті правила.** Створити `reminders/helpers.ts` з `staleCutoff` і `shouldNudge` + unit-тест; сервіс викликає їх.
5. **Репозиторій.** Один запит `listStalePulls`, що повертає `owner`, `name`, `findingsCount` (join на `repos`, агрегат `count()` по `findings`→`reviews`, усе з `workspaceId`); видалити `getRepo`/`countFindings` та N+1; повертати контрактні типи. Додати `repository.it.test.ts`.
6. **Композиція.** Додати в `platform/container.ts` ліниве `remindersRepo` (+ `ContainerOverrides`), а в route прибрати `new RemindersRepository(container.db)` й імпорт репозиторію. Сервіс будується з `container.remindersRepo` і `container.github`.
7. **Стійкість.** Визначити поведінку при збої GitHub для окремого PR (рахувати як `skipped`, логувати) і покрити unit-тестом із фейковим `github`.
8. **Перевірка.** `cd server && pnpm typecheck && pnpm test && pnpm arch:check`; baseline не чіпати й не збільшувати.
