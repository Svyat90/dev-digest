# Огляд модуля webhooks

## Причини симптомів

**1. Підпис то проходить, то ні (`routes.ts:8`).** HMAC рахується від `JSON.stringify(req.body)`, тобто від переформатованого тіла, а не від байтів, які підписав GitHub. Пробіли, порядок ключів, екранування unicode і числа після parse/stringify можуть відрізнятися, тому підпис збігається лише для "щасливих" payload. Виправлення: зберігати raw body (`addContentTypeParser('application/json', { parseAs: 'buffer' }, ...)` у scope плагіна, або `fastify-raw-body`) і рахувати HMAC від нього.

**2. 500 "delivery failed" (`service.ts:35`).** `insert` в `pull_requests` порушує унікальний індекс `pr_repo_number_uq (repo_id, number)`. Це трапляється при redelivery, а також при `synchronize`, `edited`, `closed` та інших діях для вже відомого PR. Обробляється будь-яка `action`. Виправлення: upsert (`onConflictDoUpdate` по `(repoId, number)`), обробляти лише потрібні `action` (`opened`, `reopened`, `synchronize`, `edited`), для решти повертати 202.

Інші джерела 500 у цьому ж модулі:
- `req.body as never` без валідації: payload без `pull_request` дає TypeError (наприклад, `ping` не проходить, але `pull_request` з іншою формою — так).
- `branch: head_ref ?? ''`. Справжнє поле — `pull_request.head.ref`, а `head_ref` у payload GitHub немає, тому гілка завжди порожня. Це тихий баг даних.
- `full_name.split('/')` + `owner!`: при дивному значенні в запит піде `undefined`.

## Що ще не так

- **Безпека.** Якщо `GITHUB_WEBHOOK_SECRET` не заданий, `secret = ''`, і будь-хто може підписати запит порожнім ключем. Треба fail-closed: якщо секрету немає, відхиляти (або падати на старті).
- **Секрети й конфіг.** `process.env` читається у service. Це порушує правило "secrets — один chokepoint" (`SecretsProvider` / `platform/config.ts`) і чистоту ring-ів.
- **Ідемпотентність і tenancy.** Пошук repo лише по `owner+name`, без `workspaceId`. Якщо той самий репозиторій є у двох workspace, береться випадковий.
- **Помилки.** 401 для поганого підпису ок, але `AppError` має мапитись у конверт у `app.ts`; відсутній заголовок підпису теж 401, це правильно. Невідомий repo мовчки ігнорується (202), що прийнятно, але варто логувати.
- **Нема валідації payload.** Потрібна zod-схема події (Zod 3), парсити один раз на краю.

## Архітектурні порушення (onion)

- `service.ts` (application) імпортує `drizzle-orm`, `db/schema.js`, `db/client.js` і приймає `Db`. Це порушує `application-does-not-know-the-orm`; `arch:check` на цьому впаде, а baseline чіпати не можна.
- Запити живуть у сервісі замість `repository.ts` (infrastructure).
- `new WebhooksService(app.container.db)` у routes: сервіс будується з сирим `db`, а не з вузьким `Deps`. Правильно: `Deps = { repos: WebhooksRepository, secret: ..., }`, що збирається з container.
- Перевірка підпису (HMAC) — чиста функція: у domain (`helpers.ts`), приймає secret і raw body, без `process.env`. Її можна юніт-тестувати без БД.
- Логіка "які action обробляти" — теж чиста функція (domain).

## Виправлення (малими кроками, кожен тримає `arch:check` зеленим)

1. `helpers.ts` (domain, чисте):
```ts
import { createHmac, timingSafeEqual } from 'node:crypto';
export function isValidSignature(secret: string, raw: Buffer, header: string | undefined): boolean {
  if (!secret || !header) return false;
  const expected = Buffer.from('sha256=' + createHmac('sha256', secret).update(raw).digest('hex'));
  const got = Buffer.from(header);
  return got.length === expected.length && timingSafeEqual(got, expected);
}
export const HANDLED_ACTIONS = new Set(['opened', 'reopened', 'synchronize', 'edited']);
```
2. `repository.ts` (infrastructure) з методами `findRepo(owner, name)` та `upsertPull(...)`:
```ts
await db.insert(t.pullRequests).values(row)
  .onConflictDoUpdate({
    target: [t.pullRequests.repoId, t.pullRequests.number],
    set: { title: row.title, headSha: row.headSha, branch: row.branch, base: row.base, updatedAt: new Date() },
  });
```
(`status` і `lastReviewedSha` при конфлікті не перезаписувати.) Методи приймають `workspaceId`/або шукають repo однозначно.
3. `service.ts` (application) без drizzle: `constructor(private deps: { repo: WebhooksRepository; webhookSecret: string })`, `verify(raw: Buffer, sig)` викликає `isValidSignature` і кидає `AppError('BAD_SIGNATURE', ..., 401)`; `handlePull(event)` робить early return, якщо `!HANDLED_ACTIONS.has(event.action)`.
4. `routes.ts` (presentation): raw-body parser у плагіні, zod-схема події для `pull_request` (з `pull_request.head.ref` замість `head_ref`), `service` будується один раз з `Deps`, секрет береться з config/`SecretsProvider`, а не з `process.env`. Хендлер: verify → parse → один виклик сервісу → 202.
5. Тести: unit для `isValidSignature` (raw vs перестрінгований body, порожній секрет), unit для сервісу з fake repo (повторна доставка не падає), `*.it.test.ts` для upsert на реальному Postgres.
6. Перевірка: `cd server && pnpm typecheck && pnpm test && pnpm arch:check`.
