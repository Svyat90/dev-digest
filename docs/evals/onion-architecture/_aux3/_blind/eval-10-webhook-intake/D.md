# Рев'ю модуля webhooks

Прочитано: `SKILL.md` (onion-architecture), `routes.ts`, `service.ts`. Файлів `server/CLAUDE.md`, `INSIGHTS.md` і `arch:check` для фікстури я не запускав, тож висновки спираються тільки на два файли модуля.

## Причини 500 ("delivery failed")

1. **`timingSafeEqual` кидає `RangeError`.** Перевірка `signature.length === expected.length` порівнює довжину в символах, а `timingSafeEqual` вимагає однакової довжини в байтах. Заголовок із багатобайтовими символами проходить перевірку довжини, але `Buffer`-и мають різний розмір. Виняток не є `AppError`, тому клієнт отримує 500 замість 401. Заголовок `x-hub-signature-256` також може бути масивом, а код приводить його до `string` через `as`.
2. **Повторна вставка PR.** `handlePull` робить `insert` на кожну дію (`opened`, `synchronize`, `closed`, `labeled` тощо) і при повторній доставці (redelivery). Дубль за унікальним ключем (repo, number) дає помилку БД і 500. Потрібен upsert, а `action` треба фільтрувати.
3. **Немає валідації тіла.** `req.body as never` без zod. Якщо відсутній `pull_request.user` чи `head`, виникає `TypeError` і 500. Парсити тіло треба один раз, на краю (у route).

## Причини "підпис то проходить, то ні"

1. **HMAC рахується від `JSON.stringify(req.body)`, а не від сирих байтів.** Fastify вже розпарсив JSON, і повторна серіалізація змінює порядок і пробіли, екранування юнікоду та `/`, а також великі числа. Тому підпис збігається лише для "простих" payload-ів. Підписувати треба точні байти, які надіслав GitHub.
2. **`process.env.GITHUB_WEBHOOK_SECRET ?? ''`.** Якщо секрет не заданий, HMAC рахується з порожнім ключем, який може підробити будь-хто. Це fail-open. Потрібно fail-closed: без секрету модуль не стартує або повертає 503.

## Що ще не так

- `branch: head_ref ?? ''` читає неіснуюче поле. Має бути `pull_request.head.ref`, інакше `branch` завжди порожній.
- `handlePull` мовчки ігнорує невідомий репозиторій і повертає 202. Для вебхука це допустимо, але варто залогувати.
- Немає ідемпотентності за `x-github-delivery`.
- `ping` та інші події отримують 202 без перевірки підпису? Ні, підпис перевіряється для всіх. Це правильно, треба зберегти.
- Зайвий `as string | undefined` для заголовка.

## Порушення onion-архітектури (SKILL §2–3, §5, §11)

| Місце | Проблема | Правило |
|---|---|---|
| `service.ts` імпортує `drizzle-orm`, `db/schema`, `db/client` | Application знає про ORM | `application-does-not-know-the-orm` |
| `service.ts` читає `process.env` | Конфіг у application/domain | конфіг живе в `platform/config.ts` |
| `routes.ts`: `new WebhooksService(app.container.db)` | Service будується з `db`, а не з вузьких `Deps`; запити не винесені в repository | SKILL §5 (Application) |
| Перевірка HMAC всередині класу з БД | Чисте правило змішане з I/O | pure function у domain, unit-тест без БД |
| Типи `PullEvent` у service | Контракт не в zod-схемі | схема у `routes.ts` (її використовує тільки цей route) |

## Виправлення

Структура модуля:

- `signature.ts` (domain, чисте):
```ts
import { createHmac, timingSafeEqual } from 'node:crypto';

export function isValidSignature(secret: string, raw: Buffer, header: string | undefined): boolean {
  if (!secret || !header?.startsWith('sha256=')) return false;
  const expected = createHmac('sha256', secret).update(raw).digest();
  const got = Buffer.from(header.slice(7), 'hex');
  return got.length === expected.length && timingSafeEqual(got, expected); // порівняння в байтах
}
```
- `routes.ts` (presentation): сирі байти, zod на краю, один виклик service.
```ts
app.register(async (scope) => {
  scope.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => done(null, body));
  const service = new WebhooksService({ repo: app.container.webhooksRepo, secret: app.container.config.githubWebhookSecret });
  scope.post('/webhooks/github', async (req, reply) => {
    const sig = req.headers['x-hub-signature-256'];
    await service.ingest({
      raw: req.body as Buffer,
      signature: Array.isArray(sig) ? undefined : sig,
      event: String(req.headers['x-github-event']),
      deliveryId: String(req.headers['x-github-delivery']),
    });
    return reply.code(202).send({ ok: true });
  });
});
```
  Парсинг JSON і zod-перевірка `PullEventSchema` робляться в `service.ingest` після успішної перевірки підпису. Невалідне тіло дає `AppError` 400, а не 500.
- `service.ts` (application): `Deps = { repo: WebhooksRepo; secret: string }`, без drizzle і без `process.env`.
  1. `isValidSignature` -> інакше `AppError('BAD_SIGNATURE', ..., 401)`.
  2. Якщо подія не `pull_request` або `action` не в `opened|reopened|synchronize|edited|closed`, повернути.
  3. `repo.upsertPullFromWebhook(...)`, де `branch = pull_request.head.ref`.
- `repository.ts` (infrastructure): `findRepoByFullName(owner, name)` (повертає `workspaceId`, `repoId`) і `upsertPull(...)` з `.onConflictDoUpdate({ target: [repoId, number], set: { title, headSha, status } })`. Це один запис, транзакція не потрібна.
- `platform/container.ts` / `config.ts`: додати `webhooksRepo` та `githubWebhookSecret` (обов'язковий, fail-closed). Секрет іде через загальний chokepoint секретів, а не напряму з `process.env`.

Тести:
- unit для `isValidSignature`: невалідний hex, багатобайтовий заголовок, порожній секрет, зміна одного байта;
- `app.inject()`: реальний підпис над сирими байтами з нестандартним форматуванням JSON, redelivery (повторний payload) і відсутність 500;
- `*.it.test.ts` для upsert.

Перед злиттям треба запустити `pnpm arch:check`. Baseline не регенерувати.
