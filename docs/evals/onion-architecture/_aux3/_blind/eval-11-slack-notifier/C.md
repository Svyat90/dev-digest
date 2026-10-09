Головна проблема: порт `Notifier` у `vendor/shared/notifier.ts` імпортує типи `ChatPostMessageArguments` і `ChatPostMessageResponse` з `@slack/web-api`. Це ядро (contracts + ports), яке може знати лише zod, а type-only імпорти теж рахуються, тож правило залежностей (`contracts-are-the-core`) порушено, а порт фактично є Slack SDK під іншою назвою. Через це Slack просочується у застосунковий шар: `modules/reviews/notify.ts` сам збирає Slack `blocks` та `mrkdwn` і читає `res.ts`, тобто use case прив'язаний до Slack, і замінити месенджер без правок логіки не вийде.

Як виправити:
1. Зробити порт нейтральним. Наприклад, `Notifier.notify({ channel, title, body }): Promise<{ id?: string }>` із власними типами, без жодного SDK-імпорту.
2. Перенести форматування (blocks, mrkdwn) в `adapters/notifier/slack.ts`. Адаптер мапить нейтральне повідомлення на `chat.postMessage` і приховує `ts`.
3. Порт має жити в каталозі портів `vendor/shared/adapters.ts` (а не в окремому файлі) і бути експортованим звідти. Те саме дзеркало потрібно у `client/src/vendor/shared`, якщо клієнт його використовує.
4. `notify.ts` залишити тонким: він бере `ReviewSummary`, формує нейтральний текст (це чиста функція, її легко тестувати) і викликає порт.
5. Дописати відсутнє. Немає підключення в `platform/container.ts`: тільки там створюється `new SlackNotifier(token)`, а токен береться через `SecretsProvider`, не з `process.env` і не з БД. Немає mock у `adapters/mocks.ts` та `ContainerOverrides` для тестів. Немає й самого виклику з сервісу рев'ю: сервіс має отримувати `Notifier` через вузькі `Deps`, а не весь `Container`.
6. Не викликати `notify` всередині транзакції, а після запису. Збій Slack не повинен валити рев'ю.

Після кожного кроку запускайте `pnpm arch:check` і не чіпайте baseline.
