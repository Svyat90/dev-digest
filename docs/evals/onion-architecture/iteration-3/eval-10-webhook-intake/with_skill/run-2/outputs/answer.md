# Огляд модуля webhooks (`routes.ts`, `service.ts`)

Прочитано: SKILL onion-architecture і `references/audit.md`, схему `db/schema/pulls.ts`, порт `GitHubClient`. Модуль перевіряв за сімома проходами аудиту. Блокери (неправильні дані або дірка в безпеці) йдуть першими, структурні зауваження після них.

## Блокери

### 1. Підпис перевіряється по не тих байтах (`routes.ts:8`) — причина «то проходить, то ні»
`JSON.stringify(req.body)` — це повторна серіалізація вже розпарсеного JSON. GitHub підписує точні байти запиту. Після parse/stringify змінюються пробіли, порядок і екранування (` `, unicode, `/`, числа). Тому HMAC збігається лише для «щасливих» payload-ів. Перевіряти треба сирий body: `addContentTypeParser('application/json', { parseAs: 'buffer' }, …)` або плагін `fastify-raw-body` (`config: { rawBody: true }`) лише для цього роуту.

### 2. Порожній секрет дає передбачуваний підпис (`service.ts:18`)
`process.env.GITHUB_WEBHOOK_SECRET ?? ''` означає: якщо змінну не задано, HMAC рахується з порожнім ключем. Будь-хто може підробити валідний підпис. Це security-дірка. Секрет має приходити через config або `SecretsProvider` (правило «secrets: one read chokepoint»). Якщо секрету немає, відповідь 503/500 (fail closed), а не «перевірка проти порожнього ключа».

### 3. Дубль доставки або `synchronize` дає 500 — причина «delivery failed» (`service.ts:35`)
Таблиця `pull_requests` має `uniqueIndex('pr_repo_number_uq')` на `(repoId, number)`, а код робить голий `insert`. Другий `pull_request` для того ж PR вже порушує unique: це `opened`, потім `synchronize`/`edited`/`reopened`, або повторна доставка (redelivery). Postgres кидає помилку, її мапить у 500, і GitHub показує «delivery failed». Потрібен upsert: `onConflictDoUpdate({ target: [repoId, number], set: { title, headSha, base, branch, updatedAt } })`. Обробляти варто лише відомі `action`, а не всі події. `status` і `lastReviewedSha` при оновленні не скидати.

### 4. Хибне поле гілки (`service.ts:11,41`)
`head_ref` не існує в payload GitHub. Гілка лежить у `pull_request.head.ref`. Через це в `branch` завжди пишеться `''`. Це мовчазна втрата даних.

### 5. Падіння на невалідному payload
`req.body as never` — жодної валідації. Відсутній `pull_request` або `repository` дає `TypeError` і 500. До того ж `x-hub-signature-256 as string | undefined` не враховує масив значень. Потрібна zod-схема події (Zod 3), яка парситься один раз на краю, у роуті.

### 6. Обробка помилок
`AppError('BAD_SIGNATURE', …, 401)` розумний. Але все інше (БД, невалідний payload) стає 500, на що GitHub реагує retry-ем. Невідомий репозиторій (`if (!repo) return`) тихо дає 202 без логу. Це варто залогувати. Для невідомого `action` чи події теж повертати 202.

## Структура (onion)

- **Imports (audit §1):** `service.ts` імпортує `drizzle-orm`, `db/schema` і `db/client`. Це порушує правило `application-does-not-know-the-orm`.
- **Construction (§2):** `routes.ts:5` — `new WebhooksService(app.container.db)`. Сервіс залежить від сирого `Db`, а не від вузьких `Deps`. `process.env` читається прямо в application-кільці.
- **Tenancy (§4):** `repos` шукається по `owner`/`name` без `workspaceId`. Якщо той самий репозиторій імпортовано у два workspace, береться випадковий. `workspaceId` береться з рядка repo, тобто визначається неявно.
- **Queries (§6):** два окремі запити (select, потім insert) без транзакції. Після upsert цього достатньо, але select+write краще звести в один метод репозиторію.
- **Output (§7):** відповідь `{ ok: true }` без `response` schema.
- **Ports (§3):** зовнішніх викликів немає. Але коли з'явиться запуск рев'ю, це піде через порт, а не прямо.
- Перевірка підпису є чистою функцією (HMAC), а не логікою БД. Її місце в domain-файлі (наприклад `signature.ts`), без `process.env`, із секретом аргументом. Тоді її можна юніт-тестувати без БД.

## Виправлення

`modules/webhooks/signature.ts` (domain, чиста функція):
```ts
import { createHmac, timingSafeEqual } from 'node:crypto';

export function isValidSignature(raw: Buffer, header: string | undefined, secret: string): boolean {
  if (!secret || !header) return false;
  const expected = Buffer.from('sha256=' + createHmac('sha256', secret).update(raw).digest('hex'));
  const given = Buffer.from(header);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
```

`routes.ts` (presentation: схема, сирий body, один виклик сервісу):
```ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { WebhooksService } from './service.js';
import { WebhooksRepository } from './repository.js';

const PullEvent = z.object({
  action: z.string(),
  number: z.number().int(),
  repository: z.object({ full_name: z.string() }),
  pull_request: z.object({
    title: z.string(),
    user: z.object({ login: z.string() }),
    head: z.object({ sha: z.string(), ref: z.string() }),
    base: z.object({ ref: z.string() }),
  }),
});

export default async function webhooksRoutes(app: FastifyInstance) {
  const service = new WebhooksService({
    repo: new WebhooksRepository(app.container.db),
    webhookSecret: () => app.container.config.githubWebhookSecret, // через config/SecretsProvider
  });

  // сирі байти лише для цього плагіна (encapsulated)
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => done(null, body));

  app.post('/webhooks/github', { schema: { response: { 202: z.object({ ok: z.literal(true) }) } } }, async (req, reply) => {
    const sig = req.headers['x-hub-signature-256'];
    service.verify(req.body as Buffer, Array.isArray(sig) ? sig[0] : sig); // 401 або fail closed

    if (req.headers['x-github-event'] === 'pull_request') {
      const event = PullEvent.safeParse(JSON.parse((req.body as Buffer).toString('utf8')));
      if (event.success) await service.handlePull(event.data);
    }
    return reply.code(202).send({ ok: true });
  });
}
```

`service.ts` (application, без drizzle і `process.env`):
```ts
const HANDLED = new Set(['opened', 'reopened', 'synchronize', 'edited']);

export class WebhooksService {
  constructor(private deps: { repo: WebhooksRepo; webhookSecret: () => string }) {}

  verify(raw: Buffer, sig: string | undefined) {
    if (!isValidSignature(raw, sig, this.deps.webhookSecret()))
      throw new AppError('BAD_SIGNATURE', 'Invalid signature', 401);
  }

  async handlePull(e: PullEventDto) {
    if (!HANDLED.has(e.action)) return;
    const [owner, name] = e.repository.full_name.split('/');
    await this.deps.repo.upsertPull(owner!, name!, {
      number: e.number, title: e.pull_request.title, author: e.pull_request.user.login,
      branch: e.pull_request.head.ref, base: e.pull_request.base.ref, headSha: e.pull_request.head.sha,
    });
  }
}
```

`repository.ts` (infrastructure, увесь drizzle тут):
```ts
async upsertPull(owner: string, name: string, p: PullInput) {
  const repos = await this.db.select().from(t.repos)
    .where(and(eq(t.repos.owner, owner), eq(t.repos.name, name)));
  // заведено в кожному workspace, де репозиторій імпортовано
  for (const repo of repos) { /* нижче: один insert з масивом values замість циклу */ }
  if (!repos.length) return;
  await this.db.insert(t.pullRequests)
    .values(repos.map((r) => ({ workspaceId: r.workspaceId, repoId: r.id, ...p, status: 'needs_review' })))
    .onConflictDoUpdate({
      target: [t.pullRequests.repoId, t.pullRequests.number],
      set: { title: p.title, branch: p.branch, base: p.base, headSha: p.headSha, updatedAt: new Date() },
    });
}
```
(Цикл-заглушку в коментарі прибрати: один `insert … values(array)` — без N+1.)

## Порядок кроків (кожен лишає `pnpm arch:check` зеленим)
1. Raw body + `signature.ts` + fail closed при порожньому секреті (блокери 1, 2) і юніт-тест підпису: однакові байти дають true, змінений пробіл дає false, порожній секрет дає false.
2. Upsert замість insert + `head.ref` + zod-схема події (3, 4, 5), тест на повторну доставку.
3. Винести drizzle у `repository.ts`, `Deps` замість `Db` (структура).
4. Явне scoping по `workspaceId` та `response` schema.
