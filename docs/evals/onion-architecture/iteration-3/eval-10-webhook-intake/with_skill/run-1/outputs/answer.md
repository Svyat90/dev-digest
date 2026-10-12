# Огляд модуля `webhooks` (прочитано: SKILL.md, references/audit.md, схему `pull_requests`)

Модуль: `routes.ts` (16 рядків) і `service.ts` (47 рядків). Проходжу аудит у порядку з audit.md. Блокери (неправильні дані або діра в безпеці) позначені окремо від проблем структури.

## Причини двох симптомів

### A. Підпис то проходить, то ні (блокер)
`routes.ts:8` — `const raw = JSON.stringify(req.body)`. HMAC GitHub рахує по **сирих байтах** тіла. Fastify вже розпарсив JSON, тож `JSON.stringify` дає інший рядок: інший порядок пробілів, екранування unicode (` `, емодзі в заголовку PR, `/`), числа, `<`/`>`/`&`. Для простих payload збігається, для складніших ні. Звідси "то так, то ні".

Виправлення: зберігати сирий буфер. Парсер JSON у цьому плагіні потрібно замінити на такий, що віддає і буфер, і розпарсений об'єкт:

```ts
// routes.ts (всередині інкапсульованого плагіна, лише для цього модуля)
app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
  (req as any).rawBody = body as Buffer;
  try { done(null, JSON.parse((body as Buffer).toString('utf8'))); }
  catch (e) { (e as any).statusCode = 400; done(e as Error, undefined); }
});
```

Далі `service.verify(req.rawBody, signature)` (тип `Buffer`, `createHmac(...).update(rawBody)`). Це доводить, що парсер лежить саме в плагіні `webhooks`, а не глобально: інші модулі не зачіпаються.

Другі проблеми в `verify`:
- `service.ts:18` — `process.env.GITHUB_WEBHOOK_SECRET ?? ''`. Якщо змінна не задана, секрет порожній і будь-хто може підписати запит порожнім ключем. Це діра в безпеці: порожній секрет треба відхиляти (відповідь 500/503 `ConfigError`, не "перевірка пройшла").
- Секрет читається зі змінної середовища напряму в застосунковому шарі. У репо секрети йдуть через один вхід (`SecretsProvider` / `platform/config.ts`). Секрет приходить в `Deps` ззовні.
- `Buffer.from(signature)` + перевірка довжини вже правильна (захищає `timingSafeEqual` від винятку). Залишити, але порівнювати як hex-буфери.
- Заголовок `x-hub-signature-256` може бути масивом, тоді `as string | undefined` бреше. Треба `typeof === 'string'`.

### B. "Delivery failed" (500)
1. **Повторна доставка = порушення унікального індексу (блокер).** `service.ts:35` робить голий `insert` у `pull_requests`, а в схемі є `uniqueIndex('pr_repo_number_uq')(repoId, number)`. GitHub надсилає `pull_request` на кожну дію (`opened`, `synchronize`, `reopened`, `edited`, `closed`...) і повторює невдалі доставки. Перша дія вставляє рядок, усі наступні кидають `duplicate key` і повертають 500. Виправлення: `onConflictDoUpdate` по `(repoId, number)`, оновлюючи `title`, `headSha`, `base`, `branch`, `status` (див. п. нижче про `status`). Репозиторій має робити це в одному запиті.
2. **Хибні поля payload (блокер, тихо псує дані).** `head_ref` не існує в payload GitHub, гілка лежить у `pull_request.head.ref`. Тому `branch` завжди `''`. Тип `PullEvent` має це відобразити (`head: { sha, ref }`).
3. **Помилки парсингу та валідації.** `req.body as never` — кастинг без перевірки. `event.pull_request.user.login` або `repository.full_name` можуть бути відсутні (інші події, `ping`), тоді `TypeError` і 500. Парсити Zod-схемою один раз на краю (`PullEventSchema.safeParse`, при невдачі `AppError` 400). `full_name.split('/')` з `owner!`/`name!` теж ховає помилку.
4. **Підпис кидає `AppError` 401 — це нормально**, але за відсутності обробки для `ping` GitHub отримає 401, якщо секрет не збігся. Подія `ping` має відповідати 200/202 без побічних ефектів після перевірки підпису.
5. **Хибна поведінка при невідомому репо.** `if (!repo) return;` повертає 202 і мовчки ігнорує. Для вебхука це припустимо (репо не імпортовано), але варто залогувати. Не помилка.

## Що ще не так (аудит по проходах)

**1. Імпорти (структура).**
- `service.ts:2-4` — застосунковий шар імпортує `drizzle-orm`, `db/client`, `db/schema`. Це порушує `application-does-not-know-the-orm` (SKILL §2, §3). Запити мають бути в `modules/webhooks/repository.ts`.
- `routes.ts` не імпортує drizzle, добре.

**2. Конструювання.**
- `routes.ts:5` — `new WebhooksService(app.container.db)`: сервіс отримує сирий `Db`, а не вузькі залежності. Має бути `new WebhooksService({ repo: new WebhooksRepository(app.container.db), webhookSecret })`, де репозиторій створюється у плагіні (композиція), а секрет береться з config/secrets.

**3. Порти.** Зовнішніх викликів немає. Нових портів не потрібно.

**4. Тенанстність (блокер).** `service.ts:29-32` шукає репо за `owner` + `name` **без `workspaceId`**. Якщо один і той самий `owner/name` імпортовано у двох воркспейсах, `[repo]` бере довільний, і PR потрапляє не туди. Вебхук не має контексту воркспейсу, тому репозиторій має повертати **всі** збіги (або знайти репо за унікальним ключем, якщо він є), і запис робиться для кожного воркспейсу. Рішення треба явно зафіксувати, а не покладатися на порядок рядків.

**5. Записи.** Один запис, транзакція не потрібна. Але `status: 'needs_review'` на `synchronize` скидає статус і не враховує `closed`/`merged`. Правило виведення статусу з `action` — чиста функція (`status.ts`/`helpers.ts`), яку можна тестувати без БД. Також не оновлюються `additions/deletions/filesCount`, `body`, `openedAt`, `updatedAt` (є в payload).

**6. Запити.** Один `select` + один `insert`. Після переходу на upsert можна об'єднати пошук репо й запис в одному методі репозиторію. N+1 немає.

**7. Вихід.** Відповідь `{ ok: true }` без `response`-схеми. Додати `response: { 202: z.object({ ok: z.literal(true) }) }`. Також немає схем `headers`/`body` на маршруті.

**Тести.** Нуль тестів. Потрібні: unit-тест `verify` (збіг, незбіг, відсутній підпис, порожній секрет, підпис по сирому тілу з unicode), unit-тест чистої функції статусу, `*.it.test.ts` репозиторію (повторна доставка не падає), `app.inject()` на маршрут (202 / 401).

## Цільова форма

```
modules/webhooks/
  routes.ts       // content-type parser з rawBody, Zod-схеми, один виклик service
  service.ts      // Deps { repo, webhookSecret }, verify(rawBuffer, sig), handlePull(event)
  repository.ts   // findReposByFullName(owner, name), upsertPullRequest(...)
  helpers.ts      // verifySignature (чиста), statusFromAction (чиста)
```

```ts
// service.ts
export interface WebhooksDeps { repo: WebhooksRepository; webhookSecret: string }
export class WebhooksService {
  constructor(private deps: WebhooksDeps) {}
  verify(raw: Buffer, signature: string | undefined) {
    if (!this.deps.webhookSecret) throw new ConfigError('GITHUB_WEBHOOK_SECRET is not set');
    if (!verifySignature(this.deps.webhookSecret, raw, signature))
      throw new AppError('BAD_SIGNATURE', 'Invalid signature', 401);
  }
  async handlePull(event: PullEvent) {
    const [owner, name] = event.repository.full_name.split('/');
    await this.deps.repo.upsertPullRequest(owner, name, mapPull(event)); // ON CONFLICT (repo_id, number) DO UPDATE
  }
}
```

## Порядок виправлень (кожен крок залишає `pnpm arch:check` зеленим)
1. Сирий буфер для HMAC + відхилення порожнього секрету (усуває "то так, то ні" і діру з порожнім ключем).
2. `onConflictDoUpdate` по `(repoId, number)` + `head.ref` замість `head_ref` (усуває 500 при повторних доставках).
3. Zod-схема події на краю, обробка `ping`, `response`-схема.
4. Винести запити в `repository.ts`, сервіс на вузькі `Deps` (прибирає порушення `application-does-not-know-the-orm`).
5. Рішення щодо `workspaceId` при пошуку репо.
6. Чиста функція статусу та тести з розділу вище.
