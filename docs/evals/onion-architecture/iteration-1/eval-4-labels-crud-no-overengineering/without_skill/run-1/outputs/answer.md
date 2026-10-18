# Рефакторинг модуля labels до onion architecture

Я прочитав `server/CLAUDE.md`, `server/INSIGHTS.md`, `modules/labels/routes.ts`, `repository.ts` і `db/schema/labels.ts`.

## Що зараз не так

- `routes.ts` створює `new LabelsRepository(container.db)` сам, тобто route знає про репозиторій і Drizzle `Db`.
- `routes.ts` містить логіку застосунку: `NotFoundError` при `null` / `false` з репозиторію.
- `repository.ts` повертає DTO (`createdAt` як ISO-рядок), а тип `Label` оголошений у репозиторії.
- Конвенція `server/CLAUDE.md` вимагає, щоб поруч із `routes.ts` і `repository.ts` лежав `service.ts`. Його тут немає.

Реальних бізнес-правил у модулі майже немає:

- Є upsert за `(workspace_id, name)`.
- Є правило "потрібне хоча б одне з name / color", але воно вже живе в zod-схемі.
- Решта це чотири тонкі CRUD-операції.

## Моя рекомендація: не робити use-case клас на ендпоінт і окремий domain-шар

Ти просиш три речі: service, domain-шар і use-case клас на кожен ендпоінт. Для цього модуля перші дві частково, а третя зайва.

- **`LabelsService`: так.** Це конвенція репозиторію, і саме він забирає 404-логіку з route.
- **Use-case клас на ендпоінт: ні.** Вийшло б 4 класи по 5-10 рядків, кожен з яких лише викликає один метод репозиторію. Це церемонія без користі. У репозиторії жоден модуль так не зроблений: `agents` має `routes + service + repository + helpers + constants`. Use-case клас виправданий, коли операція координує кілька репозиторіїв, транзакцію чи зовнішні порти. Тут цього немає.
- **Domain-шар: мінімальний.** Окремий каталог `domain/` з entities, value objects і портами тут не потрібен. Достатньо одного файлу `types.ts` з типом `Label` та портом репозиторія (інтерфейс), щоб сервіс не залежав від Drizzle. Якщо навіть порт здається зайвим, його можна пропустити: сервіс залежить від класу `LabelsRepository`, який уже ізолює Drizzle.
- **Правки `db/schema/labels.ts`: не потрібні.** Схема це інфраструктурний шар, і вона вже правильна (унікальний індекс `labels_ws_name_uq` потрібен для upsert). Нічого в ній не змінюй.

Якщо згодом з'являться реальні правила (ліміт кількості лейблів на workspace, заборона видаляти лейбл, що використовується, нормалізація імені, транзакційні багатотабличні записи), тоді виділяй use-case клас саме для тієї операції, а не для всіх чотирьох.

## Файли

```
server/src/modules/labels/
  routes.ts        (змінити)  тонкий HTTP-адаптер
  service.ts       (новий)    LabelsService
  repository.ts    (змінити)  лише Drizzle, без визначення типу Label
  types.ts         (новий)    тип Label + порт LabelsRepo
server/src/modules/index.ts   (без змін; плагін уже зареєстровано)
server/src/db/schema/labels.ts (без змін)
```

### `types.ts` (новий)

```ts
export interface Label {
  id: string;
  name: string;
  color: string;
  createdAt: string;
}

export interface LabelInput {
  name: string;
  color: string;
}

export type LabelPatch = Partial<LabelInput>;

/** Port: what the service needs from persistence. Implemented by LabelsRepository. */
export interface LabelsStore {
  list(workspaceId: string): Promise<Label[]>;
  create(workspaceId: string, input: LabelInput): Promise<Label>;
  update(workspaceId: string, id: string, patch: LabelPatch): Promise<Label | null>;
  remove(workspaceId: string, id: string): Promise<boolean>;
}
```

### `repository.ts` (змінити)

- Прибрати `export interface Label`, імпортувати `Label`, `LabelInput`, `LabelPatch`, `LabelsStore` з `./types.js`.
- Додати `implements LabelsStore`.
- Перейменувати `rename` на `update` (метод ще й перефарбовує).
- Решта коду без змін. Усі запити вже скоупляться по `workspaceId`.

```ts
import { and, asc, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { Label, LabelInput, LabelPatch, LabelsStore } from './types.js';

// toLabel, list, create, remove: as today
export class LabelsRepository implements LabelsStore {
  constructor(private db: Db) {}
  // ...
  async update(workspaceId: string, id: string, patch: LabelPatch): Promise<Label | null> {
    const [row] = await this.db
      .update(t.labels)
      .set(patch)
      .where(and(eq(t.labels.workspaceId, workspaceId), eq(t.labels.id, id)))
      .returning();
    return row ? toLabel(row) : null;
  }
}
```

### `service.ts` (новий)

Без імпорту `drizzle-orm`, `fastify` і `db/*`. Тільки `types.ts` і `platform/errors.ts`.

```ts
import { NotFoundError } from '../../platform/errors.js';
import type { Label, LabelInput, LabelPatch, LabelsStore } from './types.js';

export class LabelsService {
  constructor(private store: LabelsStore) {}

  list(workspaceId: string): Promise<Label[]> {
    return this.store.list(workspaceId);
  }

  /** Upsert by (workspace, name): an existing name is recolored. */
  create(workspaceId: string, input: LabelInput): Promise<Label> {
    return this.store.create(workspaceId, input);
  }

  async update(workspaceId: string, id: string, patch: LabelPatch): Promise<Label> {
    const label = await this.store.update(workspaceId, id, patch);
    if (!label) throw new NotFoundError('Label not found');
    return label;
  }

  async remove(workspaceId: string, id: string): Promise<void> {
    const removed = await this.store.remove(workspaceId, id);
    if (!removed) throw new NotFoundError('Label not found');
  }
}
```

### `routes.ts` (змінити)

- Прибрати імпорт `NotFoundError` та `LabelsRepository` з тіла хендлерів.
- Склеїти залежності один раз на вході плагіна: `const service = new LabelsService(new LabelsRepository(container.db))`.
- Zod-схеми (`LabelDto`, `CreateLabelBody`, `UpdateLabelBody`) лишаються в route (validation schema-first, як вимагає `server/CLAUDE.md`).
- Хендлери лише дістають `workspaceId`, викликають сервіс і формують відповідь.

```ts
const service = new LabelsService(new LabelsRepository(container.db));

app.get('/labels', { schema: { response: { 200: z.array(LabelDto) } } }, async (req) => {
  const { workspaceId } = await getContext(container, req);
  return service.list(workspaceId);
});

app.post('/labels', { schema: { body: CreateLabelBody, response: { 201: LabelDto } } },
  async (req, reply) => {
    const { workspaceId } = await getContext(container, req);
    return reply.code(201).send(await service.create(workspaceId, req.body));
  });

app.patch('/labels/:id',
  { schema: { params: IdParams, body: UpdateLabelBody, response: { 200: LabelDto } } },
  async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.update(workspaceId, req.params.id, req.body);
  });

app.delete('/labels/:id', { schema: { params: IdParams } }, async (req, reply) => {
  const { workspaceId } = await getContext(container, req);
  await service.remove(workspaceId, req.params.id);
  return reply.code(204).send();
});
```

## Перевірка

- `cd server && pnpm typecheck && pnpm test` (за CLAUDE.md).
- `pnpm arch:check`. Новий код не повинен додавати порушень, а baseline не регенерувати.
- Один юніт-тест на `LabelsService` з фейковим `LabelsStore` (404 на `update` і `remove`), у дусі TESTING.md: один happy path і один важливий край.
- Інтеграційні тести (`*.it.test.ts`), якщо вони вже є для `/labels`, мають пройти без змін, бо HTTP-контракт не змінюється.

## Якщо все ж хочеш use-case класи

Це можливо, але я б це не робив. Додай `use-cases/{list,create,update,delete}-label.ts`, кожен із `execute(...)` і залежністю від `LabelsStore`. `LabelsService` тоді стає фасадом або зникає, а route викликає use-cases. Це додає 4 файли і 4 класи без нового коду поведінки, тож зроби це, коли в одній із операцій з'явиться справжня оркестрація.
