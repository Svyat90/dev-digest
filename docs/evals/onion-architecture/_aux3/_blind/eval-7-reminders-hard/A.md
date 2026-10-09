# Рев'ю модуля `reminders` (структура, onion)

Прочитано: SKILL.md, references/audit.md, порт `GitHubClient` у `server/src/vendor/shared/adapters.ts`. Файли розглянуто за порядком проходів audit (імпорти, побудова, порти, тенансі, записи, запити, вихід). `arch:check` не запускався (фікстура).

Шляхи нижче відносні до `modules/reminders/`.

## Блокери (код не працюватиме або дає хибний стан)

1. **service.ts:24-25 (і routes.ts:17) — виклики методів, яких немає на порті.** `GitHubClient` (`vendor/shared/adapters.ts:151-177`) не має `addLabels` та `requestReviewers`, є лише `currentLogin`. Сервіс спирається на конкретний `OctokitGitHubClient` через каст. Правило: audit §3 (метод має існувати на порті). Реалізація мок-адаптера теж не матиме цих методів.
2. **service.ts:23-26 — write → outside call → write без безпечного стану.** Цикл шле зовнішні виклики послідовно. Якщо `requestReviewers` падає після `addLabels`, PR лишається з міткою, але без ревьюера, а повторний запуск знову додає мітки та запити без перевірки "вже надіслано" (немає ідемпотентності, жодного маркера `pending/sent` у БД). Правило: audit §5 (порядок ефектів). Також `ctx.repo!` (рядки 24-25) обходить перевірку null: фільтр `needsNudge` це гарантує, але тип цього не знає.
3. **service.ts:20 + helpers.ts:21-25 — N+1.** Для кожного stale PR по 2 запити (`getRepo`, `countFindings`) у `Promise.all` по рядках. `getRepo` однаковий для PR одного репозиторію, його слід підняти з циклу. Правило: audit §6.

## Структурні знахідки

4. **service.ts:1, 7 та routes.ts:4, 17 — зовнішнє кільце в application/presentation.** Імпорт типу `OctokitGitHubClient` з `adapters/github/octokit.js` (type-only теж рахується); правило `no-concrete-adapters-in-modules`. Залежність має бути `GitHubClient` з `@devdigest/shared`.
5. **helpers.ts:1,16-26 — domain імпортує repository (infrastructure) і містить I/O.** `import type ... from './repository.js'` порушує напрямок залежностей (domain не знає інфраструктури); `loadPullContext` робить запити, тож це не чиста функція (SKILL §2/§5, `domain-is-pure`). Тип `StalePull` визначений у repository.ts:5 і витягується всередину; його слід перенести в domain/contracts. Чисті частини (`cutoffFor`, `needsNudge`, константи) залишаються у `helpers.ts`, а `loadPullContext` йде в сервіс/репозиторій.
6. **routes.ts:15-19 — `new RemindersRepository(container.db)` у route plugin і `container.db` у presentation.** Побудова репозиторію з сирого `db` у routes. Правило: construction belongs to composition root (audit §2); репозиторій і сервіс мають збиратися в контейнері (`container.remindersService`) або сервіс одержує вузькі `Deps` з контейнера. Це ще й тягне залежність routes від `RemindersRepository` (infrastructure).
7. **service.ts:5-9 — `Deps` частково звужені, але `repo` це `Pick<RemindersRepository,...>` (клас інфраструктури).** Потрібен власний інтерфейс-порт у модулі (`StalePullsReader` тощо) без залежності від конкретного класу. Другорядно.
8. **routes.ts:21 — немає `params/body` схеми; відповідь схематизована коректно (NudgeResponse), тут усе гаразд.** Лише зауваження: схема відповіді, якщо потрібна клієнту, має жити в `vendor/shared/contracts/` (і в копії клієнта).
9. **repository.ts:43-50 — `countFindings` вибирає всі рядки й рахує `rows.length`.** Має бути `count()` в SQL (звідси ж частина N+1: потрібен один груповий запит `countFindingsByPr(workspaceId, prIds[])`). Тенансі тут правильна (join з reviews, `workspaceId`), `listStalePulls` та `getRepo` теж скоуплені. Повернення `getRepo` без явного типу (repository.ts:35) слід типізувати як `RepoRef | null`.
10. **helpers.ts:9-10 — константи в `helpers.ts`:** допустимо, але за конвенцією краще `constants.ts`. Низький пріоритет.

Проходи без знахідок: тенансі (§4) чиста; `service.ts` не імпортує drizzle/fastify.

## Впорядкований план виправлення (кожен крок залишає `pnpm arch:check` зеленим)

1. **Порт.** Додати `addLabels(repo, n, labels)` та `requestReviewers(repo, n, logins)` (або один use-case метод `nudgePull`) у `GitHubClient`, без SDK-типів у сигнатурі → реалізувати в `adapters/github/octokit.ts` → додати в `adapters/mocks.ts`.
2. **Прибрати Octokit.** У service.ts та routes.ts замінити `OctokitGitHubClient` на `GitHubClient`, видалити каст; прибрати `!` (звузити тип контексту після фільтра).
3. **Очистити domain.** Перенести `StalePull`/`PullContext` у domain-файл без імпорту repository; залишити в `helpers.ts` лише `cutoffFor`, `needsNudge`, константи; `loadPullContext` видалити.
4. **Усунути N+1.** У репозиторії додати `getReposByIds(workspaceId, ids)` та `countFindingsByPr(workspaceId, prIds)` з SQL `count()` + `group by`; сервіс робить 2 запити замість 2N, а `Pick` у `Deps` замінити на вузький інтерфейс.
5. **Безпечний порядок ефектів.** Перед викликом GitHub записувати стан `pending` (або перевіряти наявність мітки/ревьюера), робити виклики ідемпотентними, обробляти помилку по одному PR (лічильник `failed`), не тримати транзакцію під час виклику. Додати тест на збій посеред циклу.
6. **Композиція.** Винести побудову `RemindersRepository`/`RemindersService` у `platform/container.ts` (з `ContainerOverrides` для тестів); `routes.ts` лише `getContext` + `container.remindersService.nudgeStale(...)`, без `container.db`.
7. **Тести.** Unit для `needsNudge`/`cutoffFor` без БД; тест сервісу з мок-`GitHubClient`; `*.it.test.ts` для нових групових запитів.
8. **Фінал.** `pnpm arch:check` та `pnpm typecheck && pnpm test`; базліній не чіпати.
