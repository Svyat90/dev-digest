# Дубль review у GitHub: причина і виправлення (модуль publish)

## Причина
Транзакція тут не захищає, а шкодить. У `PublishService.publish` виклик `gh.postReview(...)` (зовнішній порт) стоїть **усередині** `uow.run(...)`. GitHub не відкочується разом із БД. Якщо `postReview` вдався, а `markSent` або commit впали (розрив з'єднання, таймаут, помилка), то весь tx rollback-ається: рядок `pending` зникає, а review на GitHub вже є. Користувач повторює запит і отримує другий review. Правило skill (розділ 6): жодних викликів зовнішніх портів усередині транзакції. Спершу fetch, потім tx лише для записів.

## Що ще не так
1. `retryPending` працює без транзакції і без «захоплення» рядка. Він бере `listPending`, робить `postReview`, потім `markSent`. Якщо `markSent` впав, рядок лишається `pending` і наступний retry надішле дубль. Два паралельні виклики retry (або retry разом з `publish`) читають той самий `pending` і обидва постять.
2. У `pending` немає стану «в процесі» або ключа ідемпотентності. GitHub не має idempotency-key, тож гарантія тут щонайбільше at-least-once, і її треба звужувати самостійно.
3. Дрібніше: `listPending` та `markSent` в `retryPending` не передають `tx`, а `markSent` не перевіряє, що рядок справді оновлено (`row!`).

## Виправлення
1. Забрати `postReview` з tx. Три кроки, кожен коротка окрема операція:
   - tx 1: `insertPending` (commit). Намір надіслати збережений до виклику GitHub.
   - поза tx: `postReview`.
   - tx 2 (або один update): `markSent(reviewId)`.
   ```ts
   const pending = await repo.insertPending(workspaceId, prId, body);   // committed
   const review = await gh.postReview(...);                              // no tx
   return repo.markSent(workspaceId, pending.id, review.id);             // committed
   ```
   Якщо упаде після `postReview`, рядок лишиться `pending` і буде видимий для retry. Це краще за «review є, а запису немає».
2. Зробити перехід станів атомарним у репозиторії. Додати метод `claimPending(workspaceId, id)`: `UPDATE publications SET status='sending' WHERE id=? AND workspace_id=? AND status='pending' RETURNING *` (або `SELECT ... FOR UPDATE SKIP LOCKED` у короткій tx). Постить лише той, хто отримав рядок. `retryPending` і `publish` ідуть через `claim`, і паралельні виклики більше не дублюють. Потрібен статус `sending` (міграцію робить `pnpm db:generate`, вручну `migrations/**` не чіпати) і повернення в `pending` при помилці `postReview`.
3. Закрити залишкове вікно (crash між `postReview` і `markSent`). Покласти в тіло review стабільний маркер (наприклад `<!-- devdigest-pub:<publication.id> -->`). Перед повторною відправкою рядка, що завис у `sending`, перевірити через порт GitHub (додати `listReviews` у `vendor/shared/adapters.ts`, мок у `adapters/mocks.ts`), чи review з таким маркером уже є. Якщо є, лише `markSent`.
4. Тести: unit-тест сервісу з фейковими `Deps` (`postReview` кидає після insert: рядок лишається `pending`, дубля немає; два паралельні `retryPending`: `postReview` викликається один раз) і `*.it.test.ts` для `claimPending`.

Архітектурно решта модуля в порядку: service не імпортує drizzle, UoW іде через порт, repo приймає `TxScope`, routes тонкі. Проблема в тому, що межа транзакції проведена навколо зовнішнього виклику.
