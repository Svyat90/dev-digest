# Рев'ю Slack-нотифікера (порт, адаптер, виклик)

Прочитано SKILL.md і references/audit.md; пройдено 7 проходів. `arch:check` цього не зловить: жодного забороненого імпорту немає, проблема в тому, що саме лежить у порті.

## Головна проблема: SDK-типи в порті (прохід 1 і 3, блокер для подальшої роботи)

- `vendor/shared/notifier.ts:1` — ядро (контракти й порти) імпортує `@slack/web-api` і використовує `ChatPostMessageArguments` та `ChatPostMessageResponse` у сигнатурі. Правило `contracts-are-the-core`: `vendor/shared` може імпортувати тільки zod і саме себе. Baseline не чіпайте.
- Те саме в `modules/reviews/notify.ts:13-24`. Сервіс будує Slack Block Kit (`blocks`, `mrkdwn`) і читає `res.ts`. Це Slack-специфіка в application-кільці, тож порт є «тонкою обгорткою над SDK», а не інтерфейсом до зовнішньої системи. Підміна Slack на Teams чи e-mail зачепить і сервіс. Мок у тестах доведеться будувати з типів Slack.
- Порт лежить окремим файлом `vendor/shared/notifier.ts`. Каталог портів у цьому репо — `vendor/shared/adapters.ts`. Він експортується через `index.ts`, а до `index.ts` новий файл, судячи з вашого дерева, не додано. Також потрібен мок в `adapters/mocks.ts`.

## Виправлення (порядок із audit.md §3)

1. Порт, форма за use case, без SDK-типів, у `vendor/shared/adapters.ts`:
   ```ts
   export interface ReviewSummaryNotice { repo: string; number: number; title: string; blockers: number; warnings: number }
   export interface Notifier { notifyReviewDone(channel: string, notice: ReviewSummaryNotice): Promise<{ messageId?: string }> }
   ```
   Видаліть `vendor/shared/notifier.ts`. `ReviewSummary` з `notify.ts` переїжджає в контракти разом із портом.
2. Адаптер `adapters/notifier/slack.ts` реалізує цей метод. Блоки Block Kit, `mrkdwn` і `res.ts` стають деталлю адаптера. Адаптер залишається в infrastructure і не імпортує сервіси.
3. Мок у `adapters/mocks.ts`, щоб сервіс тестувався без мережі.
4. `modules/reviews/notify.ts` зводиться до виклику `deps.notifier.notifyReviewDone(channel, summary)`. Окремий файл-функція майже нічого не робить, тож розгляньте виклик прямо з `reviews/service.ts`.
5. Проводка в `platform/container.ts`, єдине місце, що знає `SlackNotifier`. Токен береться через `SecretsProvider` у момент виклику (секрети не в конфігу, не в git, не в БД), а не `process.env`. `Notifier` додайте в `ContainerOverrides`.
6. `@slack/web-api` додайте в `server/package.json`, до `server` і тільки туди.

## Що ще перевірити перед будівництвом

- Конструювання (прохід 2): `new WebClient` у конструкторі адаптера допустимий, бо адаптер і є кільцем, що тримає SDK. Але `new SlackNotifier(token)` має бути лише в контейнері, лениво й мемоізовано. Токен приймається значенням у конструкторі, тож контейнер має його резолвити під час виклику.
- Порядок ефектів (прохід 5): сповіщення про завершене рев'ю не слід викликати всередині транзакції, що пише результат. Спершу збережіть рев'ю, потім надсилайте. Збій Slack не повинен відкочувати чи валити збережене рев'ю: ловіть помилку, логуйте, а за потреби повторюйте. Якщо потрібні повтори, збережіть стан `notified`, щоб повтор не слав дубль.
- N+1 (прохід 6): якщо це викликатиметься в циклі по рев'ю, надсилайте одне повідомлення на подію, а не в `map`.
- Тенанція й вивід (проходи 4 і 7): у цих файлах репозиторіїв немає, тож зауважень нема. `channel` лучче брати з налаштувань робочого простору, а не з аргументів запиту.

## Підсумок

Блокер один, структурний: SDK-типи Slack у порті й Block Kit у сервісі. Залежності між кільцями формально не порушені, тому `arch:check` пройде, але порт треба переписати до того, як на ньому будуватимуть. Решта (реєстрація в `adapters.ts`, мок, проводка в контейнері, секрет через `SecretsProvider`) — механічні кроки.
