# Рев'ю структури модуля `digests`

Файли: `server/src/modules/digests/routes.ts` і `service.ts`. `repository.ts` немає.

Джерела правил: `server/CLAUDE.md` (Non-default conventions), `server/INSIGHTS.md`, патерн еталонного модуля `modules/brief`.

Правила: модуль = `routes.ts` + `service.ts` + `repository.ts`. Шари: routes -> service -> domain/ports. Drizzle живе лише в репозиторії. Адаптери резолвляться через `platform/container.ts`. Валідація задається схемою на роуті. Секрети читаються лише через `container.secrets`. Помилки – це `AppError`-підкласи з `platform/errors.ts`.

## Проблеми

| # | Файл:рядок | Проблема | Серйозність |
|---|---|---|---|
| 1 | routes.ts:4-5, 27-31 | Роут імпортує `drizzle-orm` і `db/schema` та сам робить `container.db.select()` у `GET /digests`. Запити мають бути лише в репозиторії. | Блокер |
| 2 | routes.ts:50-53 | У `POST /digests` ще один прямий запит до БД, цього разу до `pullRequests`, у роуті. | Блокер |
| 3 | routes.ts:49, 55-60 | Бізнес-логіка в роуті: обчислення вікна `since`, правило "порожньо -> 204", підрахунок `blocked` і вибір `tone` за порогом 0.3. Це логіка сервісу чи домену. | Блокер |
| 4 | routes.ts:62-66 | Роут оркеструє use case (build, потім deliver). Це має бути один метод сервісу. Build, insert і deliver ще й не атомарні, тож при падінні deliver лишається "напівстан". | Високий |
| 5 | routes.ts:32-37 | Маппінг рядка БД у DTO стоїть у роуті. Такий самий маппінг продубльовано в service.ts:25-31 і 61-67 (3 копії). Потрібен один mapper. | Середній |
| 6 | routes.ts:46-47 | Ручний `CreateDigestBody.parse(req.body)` в обробнику. Конвенція вимагає schema-first: `{ schema: { body } }`, щоб невалідний ввід відхилявся з 422 до обробника. Зараз виходить 500 або інша форма помилки. | Високий |
| 7 | routes.ts:25 і 45 | Немає `schema` для `GET /digests` і `POST /digests`, немає `response`-схеми. Для платного LLM-виклику немає й `config.rateLimit`, а `brief` його ставить. | Середній |
| 8 | routes.ts:10-13 | Zod-схема тіла оголошена локально в роуті. Контракти мають жити в `src/vendor/shared`, а `DigestDto` у service.ts:9-15 дублює її як ручний інтерфейс. Ще й `client/src/vendor/shared` дрейфує, тож зміну треба робити в обох копіях. | Середній |
| 9 | routes.ts:41 і 62 | `new DigestsService(container)` створюється в кожному запиті. Еталон будує сервіс один раз на плагін з вузьким набором залежностей. | Низький |
| 10 | service.ts:2-3, 21, 56-60, 71, 75-78 | Сервіс імпортує `drizzle-orm` і `db/schema` та працює з `container.db` напряму: select, insert, update. Drizzle має бути лише в `DigestsRepository`. | Блокер |
| 11 | service.ts:6, 72 | `new OctokitGitHubClient(process.env.GITHUB_TOKEN)`: сервіс створює конкретний адаптер сам. Це порушення правила "`new SomeAdapter()` у сервісі – баг" і зворотна залежність (service -> adapters). Потрібен `container.github()`. Це ще й обходить мок-даблів у тестах. | Блокер |
| 12 | service.ts:7, 40 | Те саме для `new AnthropicProvider(...)`. Потрібен `container.llm('anthropic')` (або `resolveFeatureModel`). | Блокер |
| 13 | service.ts:40, 72 | Секрети читаються з `process.env` напряму. Єдиний chokepoint – `container.secrets` (`LocalSecretsProvider`), а `container.github()` і `container.llm()` вже беруть токени звідти. Також `?? ''` приховує відсутній ключ, тож помилка конфігурації стає пізньою помилкою від провайдера. | Високий |
| 14 | service.ts:47, 43 | Захардкоджена модель `'claude-haiku-5-5'` і промпт-рядки прямо в методі. Модель треба брати через `container.resolveFeatureModel`, а промпти тримати в `prompt.ts` (як у `brief`, `intent`, `conventions`) з константами в `constants.ts`. | Середній |
| 15 | service.ts:1, 20, 23 | Сервіс приймає `FastifyReply` і сам відповідає 404 (`reply.code(404).send(...)`). Це протікання HTTP у шар сервісу. Треба кидати `NotFoundError` з `platform/errors.ts`, а глобальний error handler сформує конверт. Роут `GET /digests/:id` теж не працює без `reply`. | Блокер |
| 16 | service.ts:18, 5 | Конструктор бере весь `Container` (service-locator) замість вузьких портів або колбеків. Так сервіс прив'язується до `db` і до всього графа. Еталон передає `{ repo, github, llm, ... }`. | Середній |
| 17 | service.ts:4 | Імпорт `PullRow` з `db/rows.js`: у сигнатурі сервісу тип рядка БД. Потрібен доменний тип або DTO, а не рядок Drizzle. | Середній |
| 18 | service.ts:21, 71 (і routes.ts:30) | Скоупінг за `workspace_id` непослідовний. `getOne` і `deliver` не фільтрують за `workspaceId`: будь-який id з чужого воркспейсу читається, а `deliver` пише коментар і оновлює чужий рядок. Це вже не лише структура, а вразливість (IDOR). Правило: кожен запит скоупиться по `workspace_id`. | Високий |
| 19 | service.ts:73-74 | Парсинг `owner/name/issue` через `split('/')` без валідації та з `!`. Невалідне значення `deliverTo` дасть `NaN` або `undefined` у виклику GitHub. Формат треба валідувати у схемі (див. регекс у `repos/routes.ts:12`, INSIGHTS 2026-10-05). | Середній |
| 20 | service.ts:56-59, 75-78 | Insert і потім update `deliveredTo` в двох окремих викликах без транзакції і без обробки помилки доставки. Зовнішній виклик GitHub стоїть між ними, що нормально, але статус доставки треба писати в репозиторії окремим методом. | Низький |
| 21 | модуль загалом | Немає `repository.ts`. Також ця пара файлів не зареєстрована в `modules/index.ts` (за наданими файлами не видно) – перевірити одним імпортом і одним записом. Немає `*.it.test.ts` і юніт-тестів з дублями `adapters/mocks.ts`. | Середній |

## План виправлення

1. **Контракти.** Винести `CreateDigestBody` і `Digest`/`DigestSummary` зі `z.infer` до `server/src/vendor/shared`. Перевірити та синхронізувати `client/src/vendor/shared`. Тип `deliverTo` звузити регексом `owner/name#issue` (або розбити на поля).
2. **`repository.ts`.** Створити `DigestsRepository(db)` – єдине місце з Drizzle:
   - `list(workspaceId)`;
   - `getById(workspaceId, id)`;
   - `pullsUpdatedSince(workspaceId, since)`;
   - `insert(workspaceId, {...})`;
   - `markDelivered(workspaceId, id, target)`.
   Усі методи скоупляться по `workspaceId`. Один `toDigestDto(row)` – мапер для всіх трьох копій.
3. **`service.ts`.** Прибрати `drizzle-orm`, `db/schema`, `FastifyReply`, `adapters/*`, `process.env`:
   - конструктор бере `{ repo, github: () => container.github(), llm: (p) => container.llm(p), resolveFeatureModel }` (як `BriefService`);
   - один use case `create(workspaceId, {periodDays, deliverTo?})`, який рахує вікно, вибирає pulls, обчислює tone (чиста функція в `helpers.ts`), будує дайджест, доставляє. Для "порожньо" повертати `null`, а роут вирішує 204;
   - `getOne` кидає `NotFoundError`.
4. **`prompt.ts` і `constants.ts`.** Промпти та пороги (`0.3`, мілісекунди в добі, модель за замовчуванням) – туди.
5. **`routes.ts`.** Тонкий: `getContext`, виклик сервісу, відповідь. Сервіс створюється один раз на плагін. На всі три маршрути: `schema: { params/body, response }` через `fastify-type-provider-zod`; на POST – `config.rateLimit` (як у brief). Жодних `drizzle-orm`, `db/schema`, `.parse()`.
6. **Реєстрація.** Додати модуль у `modules/index.ts` (один імпорт, один запис).
7. **Тести.** Юніт для tone/вікна (helpers) і одного сервісного сценарію з `adapters/mocks.ts` (`ContainerOverrides`). Один `digests.it.test.ts` (happy path + чужий workspace -> 404).
8. **Перевірка.** `cd server && pnpm arch:check && pnpm typecheck && pnpm test`. `arch:check` має пройти без оновлення baseline (`arch:baseline` не запускати). Також `scripts/verify-task.sh server --gate`.

## Скелет цільового роуту

```ts
app.post(
  '/digests',
  {
    schema: { body: CreateDigestBody, response: { 201: Digest } },
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  },
  async (req, reply) => {
    const { workspaceId } = await getContext(container, req);
    const digest = await service.create(workspaceId, req.body);
    return digest ? reply.code(201).send(digest) : reply.code(204).send();
  },
);
```

Порядок мерджу: пункти 1, 2, 10, 11, 12, 15 (блокери) обов'язкові до мерджу. Пункт 18 – це security-фікс, його теж краще зробити зараз.
