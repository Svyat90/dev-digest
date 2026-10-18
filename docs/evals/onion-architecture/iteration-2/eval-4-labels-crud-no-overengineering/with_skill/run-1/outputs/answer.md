# labels -> onion: що створювати (і чого не створювати)

Прочитано: SKILL.md (onion-architecture), розділи 1, 4, 5, 11. Фікстури: `modules/labels/routes.ts`, `modules/labels/repository.ts`, `db/schema/labels.ts`.

## Коротко: запит завеликий для цього модуля

`labels` - це чистий CRUD: 4 ендпоінти, жодних бізнес-правил, один порт (БД), без транзакцій, без викликів GitHub/LLM. Скіл (розділ 1) прямо каже: для CRUD-модуля досить `routes.ts` + `repository.ts`, а **service, який лише пересилає виклики, не створюють**. Seemann (на якого посилається скіл): додатковий use-case шар коштує більше, ніж дає, коли одна точка входу і мало логіки.

Тому я **не раджу** робити `LabelsService`, `domain/`-шар і 4 класи use-case. Вони були б порожніми обгортками над `repo.list/create/rename/remove` і додали б ~8 файлів без жодного виграшу в тестованості чи напрямку залежностей.

## Що вже правильно

- Залежності йдуть всередину: routes -> repository (дозволено для CRUD-модуля), drizzle тільки в `repository.ts`, у routes немає `drizzle-orm` / `db/*`.
- Кожен метод репозиторію приймає `workspaceId` і скоупить по ньому.
- Репозиторій повертає DTO-подібний `Label`, а не сирий рядок; мапер `toLabel` поруч.
- 404 кидається як `NotFoundError` (AppError), а не reply.
- Репозиторій створюється один раз на плагін, як у `smart-diff`/`blast`/`brief`.

## Мінімальні зміни, які варто зробити (за потреби)

Нових шарів не треба. Дрібне, по одному кроку, `pnpm arch:check` зелений після кожного:

1. **Дублікат імені при PATCH.** `rename` може порушити `labels_ws_name_uq` і дати 500. Це реальне правило, але воно вміщається в `repository.ts`: перехопити unique violation (код `23505`) і кинути помилку з `platform/errors.ts`. Зараз там немає `ConflictError` - якщо хочеш 409, додай маленький `ConflictError extends AppError` (409) у `platform/errors.ts` (мапінг в `app.ts` вже загальний для `AppError`). Файл новий не потрібен.
2. **Назви методів.** `rename` приймає і `color` - `update` чесніше. Необов'язково.
3. **Тести.** `repository.it.test.ts` (Postgres, testcontainers): upsert-на-конфлікт у `create`, скоуп по workspace (чужий id -> `null`/`false`), unique-конфлікт у `rename`. Плюс `app.inject()`-тест на 404/204. Це покриває все, що є.
4. **DTO-тип.** Якщо клієнт теж використовує `LabelDto` - тоді (і тільки тоді) перенести схему в `src/vendor/shared/contracts/` і оновити копію в `client/src/vendor/shared`. Інакше залишити у `routes.ts`.

## Коли service справді з'явиться

Скіл (розділ 1) дає сигнали: правило дублюється у двох хендлерах; хендлер гілкується по бізнес-стану; хендлер викликає два порти; тест рахунку вимагає Postgres. Приклади для labels: ліміт кількості лейблів на workspace, заборона видаляти лейбл, що використовується, каскадне переприв'язування/злиття лейблів (мультитабличний запис -> `UnitOfWork` + транзакція), синхронізація лейблів з GitHub (другий порт).

Тоді, і лише тоді, структура така:

| Файл | Що всередині | Ring |
|---|---|---|
| `modules/labels/service.ts` | `LabelsService` з `Deps { repo: LabelsRepository(тип), uow? }`; методи-use-case'и, що оркеструють: load -> pure decision -> persist. Без drizzle/fastify. Один метод на use case, не один клас на ендпоінт | application |
| `modules/labels/helpers.ts` (або `rules.ts`) | чисті функції правил (напр. `assertLabelLimit(count)`), unit-тести без БД | domain |
| `modules/labels/routes.ts` | будує `new LabelsService({ repo: new LabelsRepository(container.db) })` один раз на плагін; хендлер = схема + `getContext` + один виклик + повернення | presentation |
| `modules/labels/repository.ts` | без змін, плюс `TxScope?` якщо з'являться транзакції | infrastructure |

Окремий `src/domain/labels/` не потрібен: `src/domain/<topic>/` - лише для чистого коду, який ділять кілька модулів. Клас-на-ендпоінт теж не конвенція цього репо: сервіси тут - один файл з методами-use-case'ами.

## Підсумок

Зараз: **нічого нового не створювати**, лише (за бажанням) обробка unique-конфлікту в репозиторії + тести. Service/domain додавати, коли з'явиться перший сигнал із розділу 1, і тоді - один `service.ts` та один файл чистих правил, а не 4 use-case класи.
