# digest-publish: чому «доставлено» без коментаря і дубль при повторі

Прочитано: SKILL.md (розділи 3–7, 11) і references/transactions.md. Файли модуля: `routes.ts`, `service.ts`, `repository.ts`.

## 1. Причина (service.ts, `publish`, рядки 30–42)

Порядок побічних ефектів неправильний:

1. `repo.insert(...)` одразу пише рядок у `digests` з `deliveredTo = owner/name#number`. Тобто «доставлено» записано ДО доставки.
2. `gh.postReview(...)` — зовнішній виклик, який може впасти (мережа, 403, rate limit).
3. `repo.finish(...)` — ще один запис, який теж може впасти вже після успішного коментаря.

Наслідки:
- Крок 2 впав: у БД є рядок з `deliveredTo`, коментаря в GitHub немає. Це і є «доставлений, а коментаря немає».
- Користувач повторює запит: `insert` створює новий рядок і `postReview` викликається знову. Якщо збій був на кроці 3 (коментар уже опубліковано), виходить другий коментар. Операція не ідемпотентна: немає ні ключа дедуплікації, ні перевірки «вже опубліковано».
- `finish` ставить `periodEnd`, тобто колонка періоду використовується як ознака завершення. Статусу доставки в моделі немає, тому «доставлено» і «в процесі» неможливо розрізнити.

Транзакція тут не лікує: за правилом розділу 6 SKILL.md зовнішній виклик (GitHub) не може бути всередині `db.transaction`, а БД і GitHub не можуть бути атомарними разом. Потрібен правильний порядок плюс ідемпотентність.

## 2. Виправлення

Схема «pending -> post -> mark delivered» з ідемпотентним ключем:

1. Прочитати pull/repo, викликати LLM (поза будь-якою транзакцією; це вже так).
2. Знайти або створити рядок digest зі статусом `pending` за унікальним ключем `(workspace_id, pr_id, content_hash)` (`upsert`/`onConflictDoNothing` + select). `deliveredTo` НЕ заповнюється. Якщо вже `delivered`, повернути його без повторної публікації.
3. Перед публікацією зробити дедуплікацію на боці GitHub: вшити в тіло коментаря маркер `<!-- devdigest:digest:<digestId> -->` і, якщо порт дозволяє, перевірити наявність такого коментаря (інакше при падінні між кроками 4 і 5 повтор все одно дасть дубль, тож без цього at-most-once не гарантується).
4. `gh.postReview(...)` (зовнішній виклик, без транзакції).
5. `repo.markDelivered(workspaceId, id, { deliveredTo, githubReviewId })` — один UPDATE, який ставить статус `delivered`, `deliveredTo` і `deliveredAt`. На помилку кроку 4 — `markFailed` (або залишити `pending`), щоб повтор міг продовжити.

Скелет сервісу:

```ts
const digest = await repo.findOrCreatePending(workspaceId, { prId, contentHash, bodyMd: summary.text });
if (digest.status === 'delivered') return digest;          // повтор нічого не дублює
const gh = await this.deps.github();
const posted = await gh.postReview(ref, pull.number, { body: withMarker(digest), event: 'COMMENT', comments: [] });
return repo.markDelivered(workspaceId, digest.id, { deliveredTo, externalId: posted.id });
```

Нюанси:
- Потрібна міграція (колонка `status`, унікальний індекс). Міграції генерує drizzle-kit (`pnpm db:generate`), руками `server/src/db/migrations/**` не правити.
- Окремі одиночні UPDATE/INSERT не потребують `UnitOfWork`. Він знадобиться, лише якщо на кроці «створити pending» з'явиться запис у кілька таблиць.
- Тест на application-рівні з fake Deps: (а) `postReview` кидає -> у репозиторії немає `delivered`; (б) повторний виклик після успіху -> `postReview` викликано один раз; (в) падіння `markDelivered` після успішного post -> повтор не публікує вдруге (через маркер/перевірку).

## 3. Що ще не так зі структурою

Спільне: напрямок залежностей у цілому дотримано (service не імпортує drizzle/fastify/адаптери, бере вузькі `Deps`, кидає `NotFoundError`). Проблеми:

- **Репозиторій повертає сирі рядки назовні** (`PullRow`, `DigestRow`, анонімний `{owner,name}`), а route віддає `DigestRow` клієнту як відповідь. Має повертатися контрактний DTO/доменний тип, з мапером поруч із репозиторієм (розділ 5, Infrastructure). Звідси ж відсутня `response`-схема у route: `schema: { params: IdParams }` тільки.
- **Дублювання чужих запитів:** `getPull` і `getRepo` читають таблиці `pull_requests` і `repos`, які належать іншим модулям (`pulls`, `repos`). Доступ між модулями має йти через контейнер (`container.reviewRepo`, repos-репозиторій) або через вузький порт, а не копією запитів у новому модулі.
- **Бізнес-правила в application-шарі без чистої функції:** модель `'claude-haiku-5-5'`, системний промпт і форма `deliveredTo` (`owner/name#number`) зашиті в `publish`. Промпт/побудову повідомлень, маркер і `deliveredTo` варто винести в чисті функції (`helpers.ts`/`constants.ts`) з unit-тестами без БД. Модель краще брати з конфігу/налаштувань, а не хардкодити.
- **Складання залежностей у route:** `new DigestPublishRepository(container.db)` та вибір провайдера `container.llm('anthropic')` робляться в `routes.ts`. Конструювання має бути на боці composition root (контейнер або фабрика `Deps`), а route лише викликає сервіс. Хардкод `'anthropic'` теж належить конфігу.
- **Семантика колонок:** `periodStart/periodEnd` використані як «створено/завершено» (`new Date()` у репозиторії); це змішує період дайджесту зі станом доставки. Потрібен явний `status`/`delivered_at`.
- **Модуль `digest-publish` пише в `digests`, який, схоже, належить іншому модулю** (таблиця в `schema/ops`). Варто перевірити власника таблиці й не створювати другий репозиторій над нею.
- Перед злиттям: `pnpm arch:check` у `server/` (базлайн не регенерувати) та unit-тести за пунктом 2.
