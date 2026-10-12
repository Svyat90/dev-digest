# Рев'ю структури модуля `reminders` (onion, перед мержем)

Файли: `server/src/modules/reminders/{routes,service,repository}.ts`. Перевірено за SKILL onion-architecture (розд. 2–5, 11). Сам `arch:check` на фікстурі не запускався. Правила dependency-cruiser названо за SKILL. Загальна оцінка: напрямок залежностей у цілому правильний (service залежить від вузьких `Deps`, repository ізольований, `workspaceId` скрізь передається). Головна проблема одна: **відсутній порт**. Решта дрібніші.

## Проблеми

### 1. [Головна] Порт `PrLabeler` оголошено в service.ts, а не у ring contracts/ports; у route він підроблений кастом
- `service.ts:4-7`: `PrLabeler { addLabel, requestReviewers }` оголошено локально в application-шарі. SKILL розд. 2 і 4 кажуть: інтерфейс до зовнішньої системи живе в `vendor/shared/adapters.ts`, а нова залежність отримує порт першою. `GitHubClient` (adapters.ts:151-176) цих методів не має, тож їх немає ні в `OctokitGitHubClient`, ні в `MockGitHubClient`.
- `routes.ts:20`: `(await container.github()) as Awaited<ReturnType<typeof container.github>> & PrLabeler`. Це type-cast, який стверджує, що GitHub-клієнт вміє `addLabel` і `requestReviewers`. Реальна реалізація цих методів не має, тож **`POST /reminders/nudge` впаде в рантаймі з `gh.addLabel is not a function`**. Typecheck цього не бачить, бо cast його вимикає.
- Наслідки: service не можна протестувати з `MockGitHubClient`, у контейнері немає місця для підміни, а контракт GitHub розходиться між модулем і ядром.
- `service.ts:11`: `Pick<GitHubClient, 'currentLogin'> & PrLabeler` лишається напівпортом: частина методів із ядра, частина локальна.

### 2. Route будує інфраструктуру: `new RemindersRepository(container.db)`
- `routes.ts:5,19`: route імпортує repository і передає йому `container.db`. Для CRUD-модуля, де route викликає свій repository, SKILL це допускає (розд. 1, 4). Тут є service з оркестрацією, двома портами (БД + GitHub) і бізнес-правилом, тому конструювання належить composition side. Приклад 3 у `references/examples.md`: `Deps` будує route-плагін або контейнер (`container.remindersRepo`, за зразком `agentsRepo` і `reviewRepo`). Це не порушення `arch:check` (route має право бачити repository свого модуля). Це зауваження про консистентність, не блокер.
- `routes.ts:21`: `now: () => new Date()` ок, годинник передається ззовні, добре.

### 3. Бізнес-правила в service змішані з I/O, а «stale» вираховує service
- `service.ts:20-21,28`: константи `STALE_AFTER_DAYS`, `LABEL` і обчислення cutoff лежать у application-шарі. SKILL розд. 4 і 5: правило, розрахунок чи статус — чиста функція в `helpers.ts` / `constants.ts` (domain). Рішення «чи слід нагадувати» (`findings === 0` → skip, `author !== me` → не запитувати рев'юера) варто винести в pure-функцію, яку можна тестувати без моків (`service.ts:42-50`).
- Це покращення, а не порушення правил.

### 4. N+1 і дублюючі запити, що ховаються за інтерфейсом repository
- `service.ts:35-41`: для кожного stale PR окремо викликаються `getRepo` і `countFindings`. Це 2 запити на PR. `countFindings` (`repository.ts:43-50`) вибирає всі рядки й бере `rows.length`, замість `count()`.
- Рекомендація SKILL (розд. 5, infrastructure): агрегати й join-и належать repository. Правильніше один метод `listStalePullsWithFindings(workspaceId, olderThan)`, що повертає `{ pull, repo: {owner,name}, findingsCount }`, з SQL `count()`, що не віддає зайві рядки.
- Також service повинен фільтрувати за результатом одного виклику, а не склеювати дані з трьох.

### 5. Repository повертає «голі» типи й оголошує DTO локально
- `repository.ts:5-11` `StalePull` оголошено тут, а `getRepo` (`repository.ts:35-41`) повертає неіменований тип `{owner, name} | undefined`.
- SKILL розд. 5: repository повертає contract- або domain-типи. `RepoRef` вже існує в `@devdigest/shared`. Використайте його замість анонімної форми.
- Service залежить від `Pick<RemindersRepository, ...>` (`service.ts:10`): тип класу з infrastructure-шару, а не власний інтерфейс. Це допустимо за таблицею (application знає «type of its own repository»), але виняток, а не еталон.

### 6. Мультикрокові побічні ефекти без стратегії відмови
- `service.ts:47-49`: `addLabel` і потім `requestReviewers` у циклі, помилка на N-му PR перериває весь батч, а перші PR вже позначені. Транзакції БД тут немає (записів у БД немає), тому UnitOfWork не потрібен. Потрібне явне рішення: збирати помилки й рахувати `skipped`, або це навмисна поведінка (тоді задокументуйте її).
- Повторний виклик `/reminders/nudge` знову ставить мітку й знову запитує рев'юера. Немає ідемпотентності (перевірки наявності мітки або записаного факту нагадування). Це продуктовий ризик, не архітектурний.

### 7. Дрібне
- `routes.ts:8` `NudgeResponse` оголошено в route. Нормально, якщо схему використовує тільки цей route (розд. 4). Якщо client теж її читає, перенесіть у `vendor/shared/contracts/` і подивіться на client-копію (корінний CLAUDE.md).
- `routes.ts:24` відсутня схема/відповідь на помилки та `params`; для POST без body це ок.
- Не видно реєстрації в `modules/index.ts`, моків у `adapters/mocks.ts` і тестів. У фікстурі їх немає, тож перевірте їх у реальному PR (чекліст розд. 11: «New external systems got a port … and a mock»).
- Заборонених імпортів (`drizzle` у route/service, fastify у service, імпорт чужого модуля) не виявлено. `repository.ts` імпортує `db/client` і `db/schema`, що для infrastructure дозволено.

## Впорядкований план виправлення (кожен крок залишає `arch:check` зеленим)

1. **Порт.** У `server/src/vendor/shared/adapters.ts` додати до `GitHubClient` методи `addLabel(repo: RepoRef, n: number, label: string): Promise<void>` і `requestReviewers(repo: RepoRef, n: number, logins: string[]): Promise<void>` (або окремий вузький інтерфейс `PrLabeler` поруч, якщо не хочете розширювати великий порт). Шлях `client/src/vendor/shared` перевірте окремо, якщо порт там дублюється (там контракти, не порти, але глянути треба).
2. **Адаптер.** Реалізувати обидва методи в Octokit-адаптері GitHub (`adapters/github/*`), єдиному місці з SDK.
3. **Мок.** Додати їх у `MockGitHubClient` (`adapters/mocks.ts`) із записом викликів (`labeled`, `reviewRequests`), щоб тестувати service без мережі.
4. **Service.** Видалити локальний `PrLabeler` (`service.ts:4-7`), у `RemindersDeps.github` використати `() => Promise<Pick<GitHubClient, 'currentLogin' | 'addLabel' | 'requestReviewers'>>`.
5. **Route.** Прибрати cast на `routes.ts:20`, передавати `github: () => container.github()`.
6. **Repository.** Замінити три методи одним агрегувальним запитом зі `count()` (проблема 4), повертати `RepoRef` і названий тип; усі запити залишити з `workspaceId` (для `findings` через join на `reviews`, як зараз).
7. **Domain.** Винести `STALE_AFTER_DAYS`, `LABEL`, `staleCutoff(now)` і `shouldNudge(findingsCount)` / `shouldRequestAuthor(author, me)` у `modules/reminders/helpers.ts` і `constants.ts`, додати unit-тести без моків БД.
8. **Wiring.** Додати `remindersRepo` у `platform/container.ts` (ліниве створення + `ContainerOverrides`) або залишити `new RemindersRepository(container.db)` в єдиному місці в плагіні; зареєструвати модуль у `modules/index.ts`.
9. **Тести.** Unit-тест service з `MockGitHubClient` і фейковим repository (нуль findings → `skipped`; автор = me → без `requestReviewers`; відсутній repo → `skipped`), `*.it.test.ts` для repository (workspace scoping, ще не merged, cutoff), `app.inject()` для маршруту.
10. **Перевірка.** `cd server && pnpm typecheck && pnpm test && pnpm arch:check`; baseline не перегенерувати.

Критично для мержу: кроки 1-5 (порт). Кроки 6-9 бажані, їх можна розкласти на окремі коміти.
