# Рев'ю: Slack-нотифікатор

**Головна проблема: порт тече вендорними типами всередину ядра.** `vendor/shared/notifier.ts` імпортує `ChatPostMessageArguments` / `ChatPostMessageResponse` з `@slack/web-api`. Це порушує правило `contracts-are-the-core`: core (`vendor/shared`) знає лише zod і себе. Type-only імпорти теж рахуються (`tsPreCompilationDeps: true`). Через це `modules/reviews/notify.ts` (application) фактично залежить від Slack SDK: будує Slack `blocks` і `mrkdwn`, знає про `channel` і читає `res.ts`. Замінити Slack на Teams чи e-mail неможливо без переписування use case.

**Інші зауваження**
- Порт лежить окремим файлом `vendor/shared/notifier.ts`, а не в каталозі портів `vendor/shared/adapters.ts`. Його треба додати туди й експортувати звідти. Копію в `client/src/vendor/shared` перевірте окремо, бо вона вже дрейфує.
- Немає mock-реалізації в `adapters/mocks.ts`, тому use case не протестувати без мережі й ключів.
- Не видно wiring у `platform/container.ts`. Потрібні lazy-конструювання `SlackNotifier` і `ContainerOverrides` для тестів. Токен має йти лише через `SecretsProvider` (секрети не в git і не в БД), а не прийматися рядком із `process.env` десь у сервісі. `new SlackNotifier(token)` не можна викликати в сервісі чи роуті.
- `notifyReviewDone` — вільна функція, яка приймає `notifier` аргументом. Місце виклику не показано. Виклик має бути у `service.ts` або `run-executor.ts` через вузькі `Deps` (а не `Container`) і після збереження результату. Слід вирішити, чи збій Slack валить рев'ю (скоріше ні: лови й логуй). Зовнішній виклик не можна робити всередині транзакції.
- Додайте `@slack/web-api` у залежності server (адаптери можуть використовувати будь-який SDK), але не в `reviewer-core` і не в `shared`.

**Як виправити (малими кроками, `pnpm arch:check` після кожного)**
1. Порт мовою домену, без жодного типу Slack. Він іде в `vendor/shared/adapters.ts`:
   `interface ReviewNotifier { notifyReviewDone(summary: ReviewSummary): Promise<{ messageId?: string }> }`.
   `ReviewSummary` стає контрактом (zod-схема в `contracts/`) або чистим типом.
2. `adapters/notifier/slack.ts` реалізує цей порт. Адаптер сам будує `blocks`/`mrkdwn` і містить `channel`: його задають у конструкторі з конфігу, а не передає use case. Вся Slack-специфіка залишається в infrastructure.
3. `modules/reviews/notify.ts` або зникає, або лишається чистою функцією `summarize(...)`, яка повертає `ReviewSummary`. Оркестрація (load -> decide -> persist -> notify) іде в service з `notifier` у `Deps`.
4. Додайте `MockNotifier` в `adapters/mocks.ts` і зареєструйте нотифікатор у `container.ts` разом з override для тестів.
5. Перевірка: `pnpm arch:check` (без росту baseline), unit-тест service з mock-нотифікатором без Postgres.
