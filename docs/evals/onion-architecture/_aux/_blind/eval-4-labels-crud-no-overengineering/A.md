# Labels: чи потрібні LabelsService, domain і use-case класи?

Прочитано: SKILL.md `onion-architecture` (розділи 1, 4, 5, 11), код `modules/labels/routes.ts`, `repository.ts` і `db/schema/labels.ts`. INSIGHTS.md і `server/CLAUDE.md` у цьому бенчмарку не читались.

## Коротко: ні, повний набір (service + domain + use-case на ендпоінт) тут шкодить

Skill прямо каже (розділ 1): для CRUD-модуля (`workspace`, `settings`) достатньо `routes.ts` + `repository.ts`, а "service, що лише пересилає виклики" не створюють. Use-case клас на кожен ендпоінт ще дорожчий: Seemann попереджає, що зайвий use-case шар коштує більше, ніж дає, коли є одна точка входу і мало логіки.

Що в labels насправді є:

| Ендпоінт | Логіка |
|---|---|
| GET /labels | `repo.list(workspaceId)`, нічого більше |
| POST /labels | `repo.create`, upsert-семантика в одному SQL-запиті |
| PATCH /labels/:id | `repo.rename` + `null` -> `NotFoundError` |
| DELETE /labels/:id | `repo.remove` + `false` -> `NotFoundError` |

Жодного з сигналів із розділу 1, які виправдовують service, немає:
- правило не дублюється у двох хендлерах;
- хендлер не розгалужується за бізнес-станом;
- хендлер не викликає два порти (DB + GitHub/LLM);
- тест не потребує Postgres лише заради перевірки обчислення.

Тому `LabelsService`, `domain/`, `CreateLabelUseCase`, `ListLabelsUseCase`, `UpdateLabelUseCase`, `DeleteLabelUseCase` були б чотирма-п'ятьма файлами з тілом `return this.repo.x(...)`. Це церемонія без користі, а не onion.

## Що вже правильно (залежності вказують всередину)

- `routes.ts` не імпортує drizzle і `db/*`: тільки zod, `getContext`, `AppError` і свій репозиторій. Для CRUD-модуля це дозволено (таблиця розділу 2, рядок Presentation).
- Репозиторій повертає DTO-тип (`Label`), а не рядки. Конвертація дати в ISO лежить поруч.
- Кожен метод приймає `workspaceId` і скоупить по ньому, включно з `update` і `delete`.
- Помилки це `NotFoundError` (`AppError`), мапінг у HTTP робить `app.ts`.
- Схема таблиці (`db/schema/labels.ts`) лишається в infrastructure, нічого переносити не треба.

## Що можна покращити малими кроками (кожен лишає `pnpm arch:check` зеленим)

Нічого з цього не вимагає нових шарів.

1. **Репозиторій створюється в route-плагіні** (`new LabelsRepository(container.db)`). Для CRUD це прийнятно, але композиція краще живе в контейнері. Якщо інші CRUD-модулі мають `container.xRepo`, додайте `container.labelsRepo` у `platform/container.ts` (з `ContainerOverrides` для тестів) і візьміть його в route. Роби це лише за наявності такої конвенції.
2. **Імпорт `../../db/schema.js` у `repository.ts`**: це infrastructure, там дозволено.
3. **Назва `rename`** приймає і `color`. Перейменуйте на `update`, це дрібне правило чистоти API без нових файлів.
4. **Тип `Label` дублює `LabelDto`** з route. Якщо клієнт теж користується цією формою, винесіть схему в `src/vendor/shared/contracts/` (і перевірте client-копію, див. кореневий CLAUDE.md). Якщо ні, лишайте на верху `routes.ts`.
5. **Тести** (за розділом 8 і TESTING.md, типологічно): один `labels.it.test.ts` для репозиторія проти реального Postgres (upsert-на-конфлікті, скоуп по workspace, `remove` повертає false для чужого id) і один `app.inject()`-тест на 404/204. Доменних юніт-тестів без БД немає чого писати, бо чистої логіки немає.

## Коли переходити до service

Додайте `modules/labels/service.ts` (з вузьким `Deps`, не `Container`) тоді, коли з'явиться реальна причина, наприклад:
- ліміт кількості лейблів на workspace або заборона зарезервованих імен (правило в двох місцях: create і update);
- видалення лейбла, що каскадно чіпає інші таблиці (тоді ще й `UnitOfWork`, розділ 6);
- синк лейблів з GitHub (другий порт у хендлері).

Тоді створюється `service.ts` (оркестрація), чиста функція правила в `helpers.ts` з юніт-тестом, і route викликає один метод сервісу. Окремий `domain/` каталог потрібен лише для коду, що ділиться між модулями (`src/domain/<topic>/`); для одного модуля вистачає `helpers.ts`.

## Підсумок: файли

- Створити: нічого обов'язкового. Опційно `labels.it.test.ts` та (за наявності конвенції) рядок у `platform/container.ts`.
- Не створювати: `service.ts`, `domain/*`, `*-use-case.ts`.
