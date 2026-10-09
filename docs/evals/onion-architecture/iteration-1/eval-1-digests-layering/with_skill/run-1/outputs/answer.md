# Рев'ю структури модуля `digests` (onion-шари сервера)

Прочитано: `onion-architecture/SKILL.md` (+ `references/examples.md`, `transactions.md`), порти в `server/src/vendor/shared/adapters.ts`, `platform/errors.ts`, `platform/container.ts`. Правило, яке порушується скрізь: **залежності йдуть тільки всередину** (routes -> service -> domain/ports; repository/adapter -> ports; конкретні класи бачить лише composition root).

Файли: `server/src/modules/digests/routes.ts` (R) і `service.ts` (S). Модуль має реальну логіку (вибір tone, LLM, GitHub, запис у БД), тому йому потрібен повний набір: route + service + repository + pure-функції.

## Проблеми

| # | Файл:рядок | Проблема | Правило / кільце |
|---|---|---|---|
| 1 | R:4-5 | Route імпортує `drizzle-orm` і `db/schema` | `routes-do-not-touch-the-db` (presentation не знає ORM) |
| 2 | R:27-31, R:50-53 | Запити Drizzle прямо в хендлерах через `container.db` (список digests, вибірка PR) | Запит і маппінг рядка -> DTO живуть у `repository.ts` (infrastructure) |
| 3 | R:32-37 | Маппінг row -> DTO в route (дублюється в S:25-31 і S:61-67 три рази) | Маппер поруч із repository / pure-функція |
| 4 | R:47 | `CreateDigestBody.parse(req.body)` вручну замість `schema: { body }` (і немає `response` схеми на жодному маршруті; `GET /digests` взагалі без schema) | Route: декларує zod `params/body/response`, без `Schema.parse(req.body)` |
| 5 | R:49, R:55-60 | Бізнес-логіка в хендлері: вікно дат, `Date.now()`, відсів порожнього результату, порахунок `blocked`, поріг 0.3 і вибір `tone` | Domain: чиста функція (`helpers.ts`), час передається ззовні; хендлер не гілкується по бізнес-стану |
| 6 | R:62-66 | Route оркеструє use case: `build` -> `deliver` (кілька викликів сервісу, два порти) | Route викликає **один** метод сервісу; оркестрація в application |
| 7 | R:41, R:62 | `new DigestsService(container)` на кожен запит | Сервіс створюється один раз на плагін, а не per request |
| 8 | R:56, S:23 | `reply.code(204/201/404).send(...)` і ручний envelope помилки в сервісі | Сервіси кидають `AppError` (`NotFoundError`), відповідь формує route / `app.ts`; `reply.code()` лише в route |
| 9 | S:1, S:20 | Service імпортує `fastify` (`FastifyReply`) і приймає `reply` аргументом | `no-framework-below-routes` |
| 10 | S:2-3, S:21, S:56, S:71, S:75 | Service імпортує `drizzle-orm` і `db/schema`, ходить в `container.db` | `application-does-not-know-the-orm` |
| 11 | S:4 | Service імпортує `db/rows.js` (`PullRow`) - тип ORM-рядка в сигнатурі `build` (R передає сирі рядки Drizzle у сервіс) | Application не називає типів з infrastructure; приймати контрактний/доменний тип (напр. `PullSummary`) |
| 12 | S:6-7, S:40, S:72 | `new AnthropicProvider(...)` і `new OctokitGitHubClient(...)` у методах сервісу | `no-concrete-adapters-in-modules`; вибір реалізації - тільки `platform/container.ts` (`container.llm('anthropic')`, `container.github()`) |
| 13 | S:40, S:72 | `process.env.ANTHROPIC_API_KEY` / `GITHUB_TOKEN` читаються в сервісі, `?? ''` мовчки ховає відсутній ключ | Env/секрети - тільки `platform/config.ts` + `SecretsProvider`; контейнер уже резолвить токени (`ConfigError` при їх відсутності) |
| 14 | S:18 | Сервіс залежить від усього `Container` | Нові сервіси беруть вузькі `Deps` (repo, `llm()`, `github()`, `uow`, `clock`) |
| 15 | S:74 | `github.createIssueComment(...)` - такого методу **немає в порту** `GitHubClient` (`vendor/shared/adapters.ts:151`), тобто код спирається на деталь конкретного адаптера | Новий зовнішній виклик = спочатку метод у порту + mock в `adapters/mocks.ts` + реалізація в адаптері |
| 16 | S:42-54 | Вибір моделі (`'claude-haiku-5-5'`) і тексти промптів зашиті в метод сервісу; провайдер захардкожений на Anthropic | Промпти/константи - у `prompt.ts` / `constants.ts` модуля (як у `brief`, `intent`); провайдер/модель - з конфігу/Deps |
| 17 | S:56-59 + S:70-78 | Багатокрокові записи без транзакції і з зовнішнім викликом між ними: insert digest -> (route) -> GitHub-коментар -> update `deliveredTo`. Якщо GitHub падає, digest лишається "недоставленим" без стану; якщо update падає після коментаря - дубль при ретраї | SKILL §6: зовнішній виклик **поза** транзакцією, записи через `UnitOfWork`; тут як мінімум - явний порядок "fetch/LLM -> одна транзакція на записи -> deliver -> окремий update" |
| 18 | S:21, S:71 | Читання `digests` по `id` без `workspaceId` (тенантність) - IDOR: будь-який workspace прочитає чужий digest. Ще й `deliver` читає `row!` без перевірки існування | Кожен repository-метод читання доменних таблиць приймає `workspaceId`; відсутність -> `NotFoundError`, а не `row!` |
| 19 | S:74 | `target.split('/')` + `Number(issue)` - парсинг/валідація `owner/name/issue` посеред сервісу, без перевірки; сміття дасть `NaN`/`undefined!` | Валідувати на краю (zod-regex у `CreateDigestBody.deliverTo`), далі - розпарсений тип |
| 20 | S:9-15 | `DigestDto` оголошений у service.ts (і ще раз структурно дублюється у відповіді `GET /digests`) | DTO, який бачить клієнт, - zod-схема в `vendor/shared/contracts/` (+ копія в client, див. root CLAUDE.md); використати як `response` схему |
| 21 | модуль цілком | Немає `repository.ts`, `helpers.ts`, `prompt.ts`, тестів; модуль не підключений до `modules/index.ts` / контейнера (перевірити в PR) | Анатомія модуля, SKILL §2/§4/§8 |

Підсумок для `pnpm arch:check`: очікувані нові порушення - `routes-do-not-touch-the-db` (R:4,5), `application-does-not-know-the-orm` (S:2,3), `no-framework-below-routes` (S:1), `no-concrete-adapters-in-modules` (S:6,7). Це **нові** порушення, тож baseline (`.dependency-cruiser-known-violations.json`) чіпати не можна - виправляти імпорти.

## План виправлення (малими кроками, після кожного `pnpm arch:check` зелений)

1. **Порт.** У `vendor/shared/adapters.ts` додати до `GitHubClient` метод `createIssueComment(repo: RepoRef, n: number, body: string): Promise<{ id: string }>` (без типів SDK у сигнатурі); реалізація в `adapters/github/octokit.ts`; `MockGitHubClient` у `adapters/mocks.ts`. Контракт `Digest`/`DigestSummary`/`CreateDigestBody` - в `vendor/shared/contracts/` (і дзеркально в `client/src/vendor/shared`).
2. **Domain (чисте, без БД).** `modules/digests/helpers.ts`: `periodSince(now, days)`, `pickTone(pulls)` (поріг 0.3 у `constants.ts`), `renderPullLines(pulls)`, `parseDeliveryTarget(str)`, `toDigestDto(row)`. `modules/digests/prompt.ts` - system-промпти за tone; `constants.ts` - модель і поріг. Unit-тести на plain-об'єктах.
3. **Infrastructure.** `modules/digests/repository.ts`: `list(workspaceId)`, `get(workspaceId, id)` (кидає `NotFoundError`), `listPullsSince(workspaceId, since): Promise<PullSummary[]>`, `create(...)`, `markDelivered(workspaceId, id, target)`. Усі Drizzle-запити й маппінг тут, усі приймають `workspaceId`; методи запису - з опціональним `tx`.
4. **Application.** `service.ts` без `fastify`, `drizzle-orm`, `db/*`, адаптерів, `process.env`:
   - `Deps = { digests: DigestsRepository; llm: () => Promise<LLMProvider>; github: () => Promise<GitHubClient>; now: () => Date }` (+ `uow`, якщо потрібна атомарність);
   - `list`, `getOne` (NotFoundError), і **один** `create(workspaceId, input)`, що робить: читає PR -> `pickTone` (pure) -> LLM -> запис digest -> (за потреби) `github().createIssueComment` -> `markDelivered`. Порожня вибірка - повертає `null`/спеціальний результат, а не `reply`.
5. **Presentation.** `routes.ts`: тільки схеми (`params`, `body: CreateDigestBody`, `response`), `getContext`, один виклик сервісу, вибір статусу (201/204) за результатом. Сервіс створюється один раз на плагін: `const service = new DigestsService({ digests: new DigestsRepository(container.db), llm: () => container.llm('anthropic'), github: () => container.github(), now: () => new Date() })` (або `container.digestsRepo`, якщо додати в контейнер). Прибрати імпорти `drizzle-orm`, `db/schema`.
6. **Composition root.** Зареєструвати плагін у `modules/index.ts`; за потреби `digestsRepo` getter у `platform/container.ts`. Секрети - тільки через контейнер.
7. **Транзакція/порядок.** Решта зовнішніх викликів (LLM, GitHub) - поза `uow.run`; записи digest і `deliveredTo` - окремі короткі кроки, помилка доставки не повинна втрачати вже збережений digest (повертати його зі станом "not delivered", ретрай ідемпотентний).
8. **Тести за кільцями.** Domain - unit; сервіс - unit з фейковими `Deps` (`MockLLMProvider`, `MockGitHubClient`); репозиторій - `digests.it.test.ts` (перевірка скоупу по `workspaceId`); route - `app.inject()` (201/204/404, невалідне тіло -> 400).
9. **Перевірка.** `cd server && pnpm arch:check && pnpm typecheck && pnpm test`; baseline не регенерувати.

## Приклад цільового route

```ts
export default async function digestsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = new DigestsService({
    digests: new DigestsRepository(container.db),
    llm: () => container.llm('anthropic'),
    github: () => container.github(),
    now: () => new Date(),
  });

  app.get('/digests', { schema: { response: { 200: z.array(DigestSummary) } } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.list(workspaceId);
  });

  app.post('/digests', { schema: { body: CreateDigestBody, response: { 201: Digest } } }, async (req, reply) => {
    const { workspaceId } = await getContext(container, req);
    const digest = await service.create(workspaceId, req.body);
    return digest ? reply.code(201).send(digest) : reply.code(204).send();
  });
}
```
