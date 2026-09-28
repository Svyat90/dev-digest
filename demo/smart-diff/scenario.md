# Демо devdigest-smart-diff — сценарій зйомки

≈2 хв. Автор знімає вручну; `cues.json` — ті самі репліки для озвучки, якщо знадобиться.
Озвучка українською, для ментора, який перевіряє ДЗ L03 (Smart Diff). Джерела правди:
`server/specs/smart-diff.md`, план `docs/plans/2026-09-26-smart-diff.md` (T020) і сценарій
«Як перевірити» з хендофу `docs/plans/2026-09-26-smart-diff-handoff.md`.

> Мова файлу — українська на прохання автора, як виняток із правила Language у `CLAUDE.md`
> (так само, як `demo/conventions/`). Написи інтерфейсу, ідентифікатори й шляхи наведено
> так, як вони виглядають на екрані.

## Припущення

- Знахідки рев'ю (скільки, на яких рядках, якої серйозності) невідомі до прогону в кадрі —
  див. «Неперевірені твердження». Усе інше звірено з екраном 2026-09-28.

## Передумови

- **Застосунок запущено з гілки `feature/l03-smart-diff`**, не з `…-test-pr`: на гілці
  тестового PR коду Smart Diff немає. `git switch feature/l03-smart-diff`, потім
  `./scripts/dev.sh` — web :3000, API :3001 (`/health`).
- Тестовий PR: гілка `feature/l03-smart-diff-test-pr`, коміт `a07bb58`
  `feat(client): add formatSize helpers backed by pretty-bytes`, PR у `main` форку
  `Svyat90/dev-digest` — **#11** (https://github.com/Svyat90/dev-digest/pull/11).
  Імпортовано в DevDigest: репо `562ddc32-33fe-4292-8ec5-83cc6bb2e528`, PR `fda8b562-f399-4ac3-9ceb-d613f6a716fa`.
- Сторінка: `/repos/562ddc32-33fe-4292-8ec5-83cc6bb2e528/pulls/11`, вкладка **Files changed**, **Smart order**.
- Файли PR (порядок GitHub) і їхні ролі:

  | Файл | Роль | +/− |
  |---|---|---|
  | `client/.env.example` | Wiring | +2 −0 |
  | `client/docs/format-size.md` | Docs | +10 −0 |
  | `client/package.json` | Core (немає в жодному списку) | +1 −0 |
  | `client/pnpm-lock.yaml` | Boilerplate | +9 −0 |
  | `client/src/lib/format-size.test.ts` | Tests | +14 −0 |
  | `client/src/lib/format-size.ts` | Core | +16 −0 |

  Заголовок на екрані: «Reviewer-ordered diff» · «6 files · +52 −0»; вкладка — «Files changed 6».
- Навмисні помилки в `format-size.ts` для рев'ю:
  1. `formatSize(null)` → «0 B» замість «—» (правило client INSIGHTS: відсутнє число — em dash);
  2. `formatSizeDelta` при від'ємній різниці → «+-1 kB».

## Pre-roll (перед кожним дублем, лише через API)

Сцена 3 клікає **Run Review** (лише General Reviewer) — автор на це погодився. Щоб дубль починався з
«Review not run yet»:

1. `GET /pulls/fda8b562-f399-4ac3-9ceb-d613f6a716fa/runs`, потім `DELETE /runs/:id` для кожного прогону на цьому PR.
   Кнопку «Delete this review run» у кадрі не клікати ніколи.
2. Перезавантажити сторінку: у заголовках груп має стояти «Review not run yet».

## 1. Групи за ролями — 25 с
**Показати:** Files changed, Smart order. Заголовок «Reviewer-ordered diff», «6 files · +52 −0»,
перемикач «Smart order / Original order». Групи зверху вниз: **Core** (2 files),
**Tests** (1 file), **Wiring** (1 file), **Docs** і **Boilerplate** згорнуті. У кожній групі —
«Review not run yet».
**Дія:** повільно прокрутити від Core до Boilerplate.
**Сказати (s1-01):** "Третя домашка — Smart Diff. Це вкладка Files changed для тестового PR. Smart Diff групує файли за роллю: спершу суть змін, потім тести, підключення, документація і згенероване."
**Сказати (s1-02):** "У кожної групи є колір, опис і кількість файлів. Docs і Boilerplate згорнуті за замовчуванням, бо їх зазвичай лише переглядають."

## 2. Boilerplate і lock-файл — 20 с
**Показати:** група Boilerplate — «Generated / mechanical — skim».
**Дія:** клікнути заголовок Boilerplate, показати `client/pnpm-lock.yaml`; навести на
`client/package.json` у групі Core.
**Сказати (s2-01):** "Розгортаю Boilerplate. Тут pnpm-lock.yaml: нова залежність pretty-bytes змінила lock-файл, і рецензенту не треба його читати рядок за рядком."
**Сказати (s2-02):** "А сам package.json лишився в Core, бо зміна залежностей — це рішення, яке варто перевірити."

## 3. Run Review — 8 с
**Показати:** кнопка **Run Review ▾** у шапці PR.
**Дія:** Run Review ▾ → **General Reviewer** (один агент, `deepseek/deepseek-v4-flash`).
Після кліку сторінка сама перемикається на живий лог «Running · 1 agent(s)»; запис
зупиняється на ньому. Очікування (~35–50 с) лишається поза кадром: pre-roll сцени 4 чекає,
поки прогін стане `done`, і повертається на вкладку Files changed кліком, без перезавантаження.
**Сказати (s3-01):** "Запускаю рев'ю одним агентом, General Reviewer. Сторінка одразу показує живий лог прогону."

## 4. Лічильник і точка — 15 с
**Показати:** та сама сторінка без перезавантаження. У заголовку Core — «● 1», у Tests — «● 1» або «● 0» (залежить від прогону);
на картці `client/src/lib/format-size.ts` — червона точка («This file has review findings»).
**Дія:** навести на лічильник Core, потім на точку на картці `format-size.ts`.
**Сказати (s4-01):** "Рев'ю завершилось. У заголовку Core з'явився лічильник: один файл зі знахідками. На картці format-size.ts — червона точка."
**Сказати (s4-02):** "Лічильник оновився сам, без перезавантаження сторінки."

## 5. Знахідка прямо в диффі — 25 с
**Показати:** `client/src/lib/format-size.ts`, рядок 10–15 (біля `formatSizeDelta`; модель ставить його по-різному) —
смуга й мітка серйозності (blocker або warning — модель ставить по-різному), під ним інлайн-картка «formatSizeDelta always prepends '+' even
for negative deltas» з кнопками Accept і Dismiss.
**Дія:** навести на картку, потім на Accept і Dismiss (не клікати). Навести на перемикач
«Hide comments & findings», не клікати.
**Сказати (s5-01):** "Знахідка стоїть прямо біля функції formatSizeDelta: вона завжди додає плюс, тож зменшення файлу покаже плюс-мінус один кілобайт."
**Сказати (s5-02):** "Смуга ліворуч показує серйозність, а Accept і Dismiss доступні прямо тут, без переходу на вкладку знахідок."
**Сказати (s5-03):** "Один перемикач ховає і коментарі GitHub, і знахідки, якщо треба подивитись на чистий дифф."

## 6. Original order і назад — 15 с
**Показати:** перемикач «Smart order / Original order».
**Дія:** клікнути Original order — плаский список у порядку GitHub, `.env.example` першим.
Потім повернутись на Smart order.
**Сказати (s6-01):** "Original order показує файли так, як їх віддає GitHub, тобто за алфавітом. Повертаюсь до Smart order."

## 7. Чому без моделі — 10 с
**Показати:** Smart order, групи Core → Boilerplate.
**Сказати (s7-01):** "І головне: групування не викликає жодної моделі. Це детермінований класифікатор за шляхом файлу, тож він миттєвий, безкоштовний і завжди дає той самий результат."

## Покриття

| Пункт «Як перевірити» (T020) | Сцена | Репліка |
|---|---|---|
| П'ять груп, Docs і Boilerplate згорнуті | 1 | s1-01, s1-02 |
| Розгорнути Boilerplate, показати lock-файл | 2 | s2-01, s2-02 |
| Run review → лічильник групи і точка на файлі | 3, 4 | s3-01, s4-01, s4-02 |
| Інлайн-знахідка | 5 | s5-01…s5-03 |
| Original order і назад | 6 | s6-01 |
| Одне речення: групування без моделі, детермінований класифікатор | 7 | s7-01 |

## Звірено з екраном (2026-09-28, гілка `feature/l03-smart-diff`)

- Вкладка «Files changed 6», заголовок «Reviewer-ordered diff 6 files · +52 −0», перемикач
  «Smart order» [pressed] / «Original order».
- Групи й файли: Core — `client/package.json`, `client/src/lib/format-size.ts` (2 files);
  Tests, Wiring — розгорнуті; Docs, Boilerplate — згорнуті. У кожній — «Review not run yet».
- Після розгортання Boilerplate видно `client/pnpm-lock.yaml +9 −0` з рядком `pretty-bytes`.
- Original order: `.env.example`, `docs/format-size.md`, `package.json`, `pnpm-lock.yaml`,
  `format-size.test.ts`, `format-size.ts`.
- Пробний прогін General Reviewer поза кадром (~50 с, потім видалений через `DELETE /runs/:id`):
  - CRITICAL `client/src/lib/format-size.ts:10` — «formatSizeDelta always prepends '+' even for negative deltas»;
  - WARNING `client/src/lib/format-size.test.ts:8` — «Missing test for negative delta in formatSizeDelta»;
  - smart-diff `finding_lines`: `format-size.ts` → `[10]`, `format-size.test.ts` → `[8]`.
  Помилку «0 B» для `null` модель не знайшла — тому s5-01 про `formatSizeDelta`.
- Другий прогін (dry run, $0.0005, 34 с): лише CRITICAL `format-size.ts:12`, та сама назва;
  у Tests лічильник «● 0».
- Прогін у зйомці (40 с): лише WARNING `format-size.ts:11`, та сама назва + «, producing malformed output».
  Тому s5-01 серйозність не називає.
- Після видалення прогону: `GET /pulls/…/runs` → `[]`, reviews → 0.

## Неперевірені твердження

- Рев'ю недетерміноване: у кадрі модель може знайти інше, ніж у пробному прогоні. Pre-roll
  сцени 4 перевіряє через API, що є знахідка на `format-size.ts` із заголовком про
  `formatSizeDelta`; якщо ні — дубль сцен 3–5 переробляється з новим прогоном.
- «Лічильник оновився без перезавантаження» (s4-02) — перевірено в сесії розробки, у кадрі
  доводиться лише тим, що сторінку не перезавантажують.
- «Миттєвий, безкоштовний, завжди той самий результат» (s7-01) — правда з коду
  (`classifyFile` — чиста функція, `GET /pulls/:id/smart-diff` не кличе модель), але кадр
  цього не доводить.
