# Рев'ю структури модуля `reminders` (onion)

Прочитано: SKILL onion-architecture (разом з references/examples.md). Файли: `modules/reminders/{routes,service,helpers,repository}.ts` у fixtures/reminders-hard. `pnpm arch:check` не запускався (fixture), тому правила перелічено за назвами з SKILL §9.

## Проблеми

| # | Файл:рядок | Проблема | Правило / кільце |
|---|---|---|---|
| 1 | `helpers.ts:1` | Domain (чисті функції) імпортує тип з `repository.ts` (infrastructure): `RemindersRepository`, `StalePull`. Залежність спрямована назовні. | `domain-is-pure`, dependency rule (type-only імпорти теж рахуються) |
| 2 | `helpers.ts:16-26` | `loadPullContext` робить I/O (`getRepo`, `countFindings`, `Promise.all`) у файлі, що має бути доменом. Це оркестрація, а не правило. Правило `needsNudge` тепер тестується тільки разом з репозиторієм. | §4/§5: оркестрація = application (`service.ts`) |
| 3 | `service.ts:1,7` | Application імпортує конкретний адаптер `OctokitGitHubClient` замість порту `GitHubClient` з `@devdigest/shared`. | `no-concrete-adapters-in-modules` |
| 4 | `routes.ts:4,17` | Те саме в presentation, плюс `as OctokitGitHubClient`: каст обходить типи і прив'язує сервіс до Octokit. | `no-concrete-adapters-in-modules` |
| 5 | `routes.ts:15-19,16` | Route збирає залежності сам: `new RemindersRepository(container.db)` і `now: () => new Date()`. `container.db` у presentation-шарі, конструювання не в composition root. | §5 Application/Presentation, «construction belongs to the composition side» |
| 6 | `service.ts:23-26`, `ctx.repo!` | Non-null assertion: `needsNudge` перевіряє `repo !== null`, але тип цього не звужує. Сервіс покладається на неявну угоду між файлами. | Якість domain-типу (наслідок №2) |
| 7 | `service.ts:20` | `Promise.all` по всіх протермінованих PR: N×2 запитів у БД без ліміту. Складова N+1. | Infrastructure: запит має бути в репозиторії одним викликом |
| 8 | `repository.ts:43-49` | `countFindings` тягне всі рядки і повертає `rows.length` замість `count()`. | §5 Infrastructure (агрегати ховаються в репозиторії) |
| 9 | `repository.ts:35-41` | `getRepo` без явного типу повернення і повертає `undefined`. Контракт витікає у helpers (`?? null`). | Repository повертає явні domain/contract-типи |
| 10 | `repository.ts:5-11` | `StalePull` (доменний тип) оголошений в infrastructure, звідси №1. | Тип має жити всередині (domain/contract) |
| 11 | `service.ts:23-26` | Зовнішні виклики GitHub у циклі послідовно, без обробки часткової збою: якщо `addLabels` пройшов, а `requestReviewers` ні, повтор POST дає неузгоджений стан. БД-запису немає, тому транзакція не потрібна, але збій одного PR зупиняє решту. | §6 (зовнішні виклики), Application |

Що в порядку: схема відповіді в routes (`routes.ts:9`), `getContext` для tenancy, сервіс створюється один раз на плагін, `Deps` вузькі (а не `Container`), `workspaceId` є в кожному запиті репозиторію, `countFindings` скоупить через join на `reviews`, `service.ts:3` імпортує тип власного репозиторію (дозволено).

## План виправлення (кожен крок залишає `arch:check` зеленим)

1. **Порт.** Перевірити, що `GitHubClient` у `vendor/shared/adapters.ts` має `currentLogin`, `addLabels`, `requestReviewers`. Якщо ні, додати їх у порт, реалізувати в `adapters/github/octokit.ts` і додати мок у `adapters/mocks.ts`. (Закриває №3, №4.)
2. **Прибрати Octokit із service і routes.** `RemindersDeps.github: () => Promise<GitHubClient>`; у `routes.ts` видалити імпорт і `as`-каст. (№3, №4.)
3. **Тип у domain.** Перенести `StalePull` і `PullContext` у `helpers.ts` (або `types.ts`), `repository.ts` імпортує їх звідти. Прибрати `import type ... from './repository.js'` з `helpers.ts`. (№1, №10.)
4. **Витягти I/O з helpers.** Перенести `loadPullContext` у `service.ts` (приватний метод) або замінити одним методом репозиторію `listStalePullsWithContext(workspaceId, olderThan)`, який робить join pull+repo і агрегує count у SQL. Лишити в `helpers.ts` лише `cutoffFor`, `needsNudge`, константи. (№2, №7.)
5. **Звузити тип.** `needsNudge` стає type guard (`ctx is PullContext & { repo: RepoRef }`) або повертає готовий список `{ pull, repo }`; прибрати `!` у сервісі. (№6.)
6. **Репозиторій.** `countFindings` через `count()` з `innerJoin` (або вбудувати в п.4), `getRepo` з явним типом `Promise<RepoRef | null>`. (№8, №9.)
7. **Composition.** Додати `container.remindersRepo` (або фабрику сервісу) у `platform/container.ts`; у `routes.ts` взяти репозиторій з контейнера, прибрати `container.db` і `new RemindersRepository`. `now` лишити як залежність. (№5.)
8. **Стійкість зовнішніх викликів.** У циклі обробляти помилки по кожному PR (збирати `failed`), за потреби обмежити паралелізм; зробити послідовність label+reviewer ідемпотентною. Зовнішні виклики не в транзакції (транзакція тут не потрібна). (№11.)
9. **Тести.** Unit-тест `needsNudge`/`cutoffFor` без БД; тест сервісу з fake `Deps` (мок `GitHubClient`); `*.it.test.ts` для репозиторію (скоуп по `workspaceId`).
10. **Перевірка.** `cd server && pnpm arch:check && pnpm typecheck && pnpm test`; базліст не регенерувати.
