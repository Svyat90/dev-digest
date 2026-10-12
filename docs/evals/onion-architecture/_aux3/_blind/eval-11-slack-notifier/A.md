# Рев'ю Slack-нотифікатора: що не так і як виправити

Головна проблема: порт `Notifier` не є портом, а SDK Slack просочився в ядро й у application-код. Рішення прийняте за правилом залежностей з `onion-architecture` (SKILL §3) і чекліст `references/audit.md`.

## Знахідки

### Блокери структури (імпорти, пас 1 і 3)

1. `vendor/shared/notifier.ts:1-5` — **ядро імпортує зовнішній SDK.** Контракти й порти в `vendor/shared` можуть знати тільки zod і самих себе (правило `contracts-are-the-core`). Тут порт імпортує `ChatPostMessageArguments` і `ChatPostMessageResponse` з `@slack/web-api`. Сигнатура порту в цьому місці є сигнатурою Slack. Це не абстракція, а Slack, прихований за інтерфейсом.
2. `modules/reviews/notify.ts:12-27` — **application-код будує Slack Block Kit.** Поля `channel`, `text`, `blocks`, `type: 'section'` і `mrkdwn` належать Slack. Тому замінити Slack на Teams чи email можна лише переписавши use case. Через `res.ts` (Slack timestamp) протікає і відповідь.
3. Порт не відповідає new-port-правилу: порти лежать у `vendor/shared/adapters.ts` (а не в окремому файлі, який ніхто не реекспортує). Треба перевірити `vendor/shared/index.ts`: `import type { Notifier } from '@devdigest/shared'` скомпілюється, лише якщо порт там експортується. Також у `package.json` сервера немає залежності `@slack/web-api` (grep нічого не знайшов), хоча її імпортують і ядро, і адаптер. `client/src/vendor/shared` теж лишається без копії, якщо контракт стане спільним.

### Структура (пас 2, 3)

4. `adapters/notifier/slack.ts:5-14` — адаптер сам нічого не знає про use case, а лише прокидає `postMessage`. Така "тонка обгортка" нічого не інкапсулює. Формування повідомлення (текст, блоки) мало б жити тут, а не в `notify.ts`.
5. Немає mock: `adapters/mocks.ts` не містить `Notifier`, тож `notifyReviewDone` не можна юніт-тестувати без мережі. Немає і підключення в `platform/container.ts` (вибір реалізації, токен із `SecretsProvider`, а не `process.env` чи аргумент конструктора). Немає й `ContainerOverrides` для тестів.
6. `notifyReviewDone` — вільна функція, що приймає порт параметром. Це прийнятно як application-функція, але вона лежить у `modules/reviews/notify.ts` без сервісу-власника, і ніхто її ще не викликає через `Deps`. Колега сказав, що "виклик" є, але в наданих файлах його немає: перевірте, що він приймає `Notifier` з контейнера, а не робить `new SlackNotifier(...)` у методі (пас 2).

### Порядок ефектів (пас 5)

7. Виклик Slack після рев'ю — це зовнішній виклик. Він не повинен виконуватися всередині транзакції, і збій Slack не має валити або відкочувати збережене рев'ю: ловіть помилку, логуйте, а за потреби ставте "notification pending" для повтору. Зараз `notifyReviewDone` кидає помилку SDK як є (не `AppError`).

## Як виправити (кроки по черзі, `pnpm arch:check` після кожного)

1. **Порт, нейтральний до вендора**, у `vendor/shared/adapters.ts` (і реекспорт), без SDK-типів:
   ```ts
   export interface ReviewSummaryNotice {
     repo: string; number: number; title: string;
     blockers: number; warnings: number;
   }
   export interface Notifier {
     notifyReviewDone(channel: string, notice: ReviewSummaryNotice): Promise<{ messageId?: string }>;
   }
   ```
   Видаліть `vendor/shared/notifier.ts`. `ReviewSummary` з `notify.ts` переїжджає в ядро як контракт.
2. **Адаптер** `adapters/notifier/slack.ts` реалізує цей метод: саме тут будуються `blocks`/`mrkdwn` і викликається `chat.postMessage`; `res.ts` повертається як `messageId`. SDK-типи не виходять за межі адаптера. Додайте `@slack/web-api` у `server/package.json` (pnpm).
3. **Mock** `Notifier` в `adapters/mocks.ts` (збирає виклики в масив).
4. **Container**: у `platform/container.ts` ліниво створюйте `SlackNotifier`, токен беріть через `SecretsProvider` (секрети не в git і не в БД), додайте в `ContainerOverrides`.
5. **Use case**: `notifyReviewDone` (або метод сервісу рев'ю) отримує `Notifier` через вузькі `Deps`, нічого не знає про Slack, викликає `notifier.notifyReviewDone(...)` після того, як рев'ю збережено і транзакцію закрито, і обробляє збій без відкату рев'ю.
6. **Тести**: юніт-тест use case з mock-нотифікатором (без мережі); за бажанням тест адаптера з підміненим `WebClient`.
7. Запустіть `pnpm arch:check`, `pnpm typecheck && pnpm test` у `server/`; baseline не регенерувати.
