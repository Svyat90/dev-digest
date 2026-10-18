# Demo eval-pipeline — shooting script

~7-8 min. Filmed by `demo-film` from `cues.json`; this file is the human view. Narration is
Ukrainian (config.tts.language `uk`); everything around it is English.

## Assumptions
- Source of truth: HW L06 "Eval Pipeline" text pasted by the author (user stories, acceptance
  criteria, checklist, stretch tasks). Coverage is mapped below.
- Scope: Core + Stretch (Case Editor, skill Evals tab, trend chart). Not covered: PreToolUse hook
  and mutation testing stretch tasks (not part of the shipped specs SPEC-04/05/06).
- Agent on camera: **General Reviewer** (already has real cases from PR #20 and several runs at v3).
- Data is prepared by a one-time **prep** and a per-take **pre-roll** through the API (below).
  Runs are NOT launched live except the cheap single-case `Run case` in scene 4.
- Browser only; same config as `demo/conventions` (Daniel, ElevenLabs, 2560x1440).

## Prep (done 2026-10-17, through the API, deepseek-v4-flash; total LLM cost about $0.02)
State on screen after prep (re-check before filming; do not repeat these steps):
- General Reviewer (`6f6e2eb2-b04c-4e37-8ed7-52f34bf52ccf`): 9 cases — the 2 real ones from PR #20
  plus 7 manual ones (5 must_find: sql-injection-user-search, off-by-one-pagination, missing-await-save,
  division-by-zero-average, hardcoded-api-token; 2 must_not_flag: clean-rename-helper, guarded-average).
- Runs on the 9-case set (rendered values, `/evals/<agentId>` RECENT RUNS):
  | Version | Prompt | Recall | Precision | Citation | Passed | Cost |
  |---|---|---|---|---|---|---|
  | v3 | original | 86% | 100% | 100% | 8 / 9 | $0.0012 |
  | v4 | + not-found rule | 57% | 100% | 100% | 6 / 9 | $0.0025 |
  | v4 | + not-found rule | 83% | 100% | 100% | 7 / 9 | $0.0013 |
  | v5 | broken on purpose | 100% | 85% | 100% | 8 / 9 | $0.0016 |
  | v5 | broken on purpose | 71% | 91% | 100% | 6 / 9 | $0.011 |
  | v5 | broken on purpose | 60% | 89% | 90% | 3 / 9 | $0.0013 |
  | v6 | original restored | 86% | 100% | 100% | 8 / 9 | $0.0010 |
  Two extra v5 runs exist because two tool calls the author rejected had already executed; there is no
  route to delete an eval run, so they stay. A v6 run failed (expired OpenRouter key, `failed`, no
  metrics) and a second v6 run completed. The latest completed run (v6) drives the cards:
  RECALL 86% +26 pt, PRECISION 100% +11 pt, CITATION ACCURACY 100% +10 pt; no alert banner.
- Agent prompt restored to the original text as v6; model unchanged (deepseek-v4-flash).
- Skill `corner-case-checklist`: 2 cases (empty-array-math-max-2 must_find, empty-array-guarded
  must_not_flag), remembered agent General Reviewer, latest skill run 2 / 2 at agent v6, skill v1.

## Pre-roll (before every take, API only)
1. Never click `Run eval` / `Run all evals` on camera for the agent: a new run changes the latest metrics and the alert.
2. `DELETE /eval-cases/:id` for the case created on camera in scene 2 (from the PR #20 finding `Breaking change to NotFoundError constructor…`; the set goes back from 10 to 9; the finding then shows `Turn into eval case` again),
   and for the case created in scene 4, if Save was clicked.
3. Check `GET /agents/:id/eval-cases` returns the prepared count again.
4. Never click `Delete agent`, `Delete this review run`, `Delete skill`, `Remove`, `Promote`,
   `Run all agents`.

## 1. Intro: what is being protected - 35 s
**Show:** Eval Dashboard `/evals`, header and the agent rows.
**Do:** still; no hover.
**Say (s1-01):** "Це Eval Pipeline у DevDigest. Він будує регресійний захист для рев'ю-агента: змінили системний промпт, модель чи прикріплений скіл — прогнали набір кейсів і побачили цифри."
**Say (s1-02):** "На лабораторній ми користувалися готовим eval-модулем для harness'а. Тут та сама методологія, але перенесена в продукт: кейси живуть у Postgres поруч зі знахідками, з яких вони народжуються."
**Say (s1-03):** "Покажу весь шлях: від прийнятої знахідки до порівняння двох версій промпта, і поясню, що я роблю і чому."

## 2. Finding to eval case in one click - 55 s
**Show:** PR #20 (Svyat90/dev-digest) Overview, General Reviewer review, the ACCEPTED finding `Breaking change to NotFoundError constructor…` (`server/src/platform/errors.ts:21`, no case yet) with `Turn into eval case`.
**Do:** hover the decision badge, click `Turn into eval case`, show the state change. MUTATING: pre-roll step 2 removes the case afterwards.
**Say (s2-01):** "Ось рев'ю агента на реальному пулреквесті. Знахідку я вже прийняв у попередніх уроках, і саме це рішення стає очікуванням. Вигадувати тестові сценарії не треба."
**Say (s2-02):** "Кнопка Turn into eval case зберігає фрагмент diff разом з очікуванням. Прийнята знахідка дає must_find: агент має знайти це місце у файлі на цих рядках."
**Say (s2-03):** "Відхилена знахідка дає must_not_flag, тобто агент не повинен коментувати цей фрагмент. Саме так у вимірювання потрапляє шум, а не тільки успіхи."
**Say (s2-04):** "Входи кейса фіксуються в момент створення. Тому прогони різних версій агента порівнянні між собою."

## 3. The agent's eval set - 50 s
**Show:** Agents → General Reviewer → tab Evals: metric cards, `Eval cases N / M passing`, rows with expectation badges, `Run all evals`, `New eval case`.
**Do:** hover a must_find row, then a must_not_flag row, then a row's run button.
**Say (s3-01):** "На вкладці Evals агента видно весь його набір. Біля кожного кейса — скільки знахідок очікується, скільки агент повернув в останньому прогоні, і чи кейс пройшов."
**Say (s3-02):** "Разом із щойно створеним у наборі десять кейсів. Більшість — must_find. Два з позначкою empty — це must_not_flag: там агент має промовчати, а будь-яка знахідка вважається шумом."
**Say (s3-03):** "Кнопка біля рядка запускає один кейс, Run all evals запускає весь набір агента. Зверху метрики останнього прогону. Зараз покажу, звідки береться кожна."

## 4. Case Editor: a hand-written case - 80 s
**Show:** `New eval case` dialog on the agent's Evals tab.
**Do:** type a name, paste a diff, show Preview and Files, set must_find with file and lines, click `+ Finding skeleton`, fill the title, show `valid JSON`, click `Run case`. MUTATING: save only if Save is clicked; pre-roll deletes it.
**Say (s4-01):** "Кнопка на знахідці покриває лише те, що агент уже бачив або пропустив. Але є баги, яких він ще не бачив: чужий інцидент чи edge case з код-рев'ю колеги."
**Say (s4-02):** "Для цього є Case Editor: кейс пишеться вручну. Вставляю фрагмент diff. Нижче прев'ю з номерами нових рядків, а у вкладці Files видно, які файли він змінює."
**Say (s4-03):** "Далі тип очікування, файл і діапазон рядків. Валідація працює під час набору: діапазон, якого немає в hunk, просто не дасть зберегти кейс."
**Say (s4-04):** "Кнопка Finding skeleton підставляє заготовку очікуваного finding з цим файлом і рядками. Лишається вписати заголовок, і з'являється бейдж valid JSON."
**Say (s4-05):** "Run case запускає лише цей кейс, окремо від історії. Поки модель відповідає, редактор показує, що прогін триває, і нічого не треба перезавантажувати."
**Say (s4-06):** "Створені вручну кейси живуть у тому самому наборі й проганяються тим самим роутом. Датасет росте з двох джерел: з історії рішень і з передбачення майбутніх провалів."

## 5. Scoring is code, not a model - 55 s
**Show:** the last run's case rows on the Evals tab (passed / failed, `expected N, got M`) and the metric cards.
**Do:** hover the three metric cards one by one.
**Say (s5-01):** "Скоринг повністю на коді, без жодного виклику моделі. Знахідка зарахована, коли збігається файл і перетинаються діапазони рядків."
**Say (s5-02):** "Суддя з лабораторної тут не потрібен: очікування — це файл і рядки, а збіг рахується детерміновано. Тому один і той самий прогін завжди дає ті самі цифри."
**Say (s5-03):** "Звідси три метрики. Recall — яка частина очікуваного знайдена. Precision — яка частина знахідок не шум; саме тут працюють кейси must_not_flag."
**Say (s5-04):** "Citation accuracy показує, яка частина знахідок пережила grounding gate, тобто справді вказує на рядки з diff."

## 6. Eval Dashboard across agents - 45 s
**Show:** `/evals` — agent rows with sparklines, `RECENT EVAL RUNS · ALL AGENTS`, button `Run all agents`.
**Do:** hover `Run all agents` (do NOT click: it runs every agent and costs money); hover a row in recent runs.
**Say (s6-01):** "В лівому меню є окрема сторінка Eval Dashboard. Вона показує всіх агентів разом: останні метрики, невеликий тренд і список останніх прогонів."
**Say (s6-02):** "Агенти без кейсів тут позначені, що кейсів немає, а не нулями. Нуль і невідомо — це різні речі."
**Say (s6-03):** "Run all agents запускає прогін для кожного агента з кейсами. На камері я його не натискаю, бо це реальні виклики моделі й реальні гроші."

## 7. Per-agent dashboard and trend - 60 s
**Show:** `/evals/<agentId>` — metric cards with deltas, `METRIC TREND` chart, the deltas on the cards (no alert banner after the v6 run), `RECENT RUNS` table with versions and cost.
**Do:** hover points on the trend chart to show the tooltip with version and cost; hover the delta on Precision.
**Say (s7-01):** "Сторінка агента: три метрики з різницею до попереднього прогону і графік тренду. Кожна точка — один прогін."
**Say (s7-02):** "У тултіпі версія промпта і вартість прогону. Тож видно не лише стрибок, а й динаміку: чи деградує precision повільно від версії до версії."
**Say (s7-03):** "Останній прогін — шоста версія, де я повернув оригінальний промпт. Recall вісімдесят шість відсотків, precision і citation знову сто, а дельти показують, наскільки це краще за зламану п'яту. Якби метрика просіла, вгорі з'явилося б попередження."
**Say (s7-04):** "Нижче таблиця прогонів із версією, метриками, кількістю пройдених кейсів і ціною."

## 8. Old prompt vs new: the experiment - 90 s
**Show:** select two runs in `RECENT RUNS` (v3 `8 / 9` 86% / 100% / 100% and the first v5 `8 / 9` 100% / 85% / 100%), click `Compare`: metric deltas and the system prompt diff.
**Do:** tick the two runs, click Compare, hover the recall and precision deltas, scroll the prompt diff; close with `Close` (do NOT click `Promote`).
**Say (s8-01):** "Тепер експеримент. Третя версія — оригінальний промпт. У четвертій я додав правило про not-found для пошуку за id. У п'ятій навмисно зіпсував промпт."
**Say (s8-02):** "Обираю прогін третьої версії і перший прогін п'ятої та натискаю Compare. Вгорі дельти recall, precision, citation і вартості, пораховані на тому самому зафіксованому наборі з дев'яти кейсів."
**Say (s8-03):** "Нижче diff системного промпта. Зламана версія просить коментувати кожен невикористаний імпорт і кожне ім'я, навіть коли все гаразд. Видно, яка саме правка зрушила цифри."
**Say (s8-04):** "Precision упав зі ста відсотків до вісімдесяти п'яти, а recall навіть зріс: агент коментує все підряд і інколи влучає. Кейси must_not_flag це зловили. Якщо метрики не реагують на зламаний промпт, вони нічого не вимірюють."
**Say (s8-05):** "Якщо набори кейсів у двох прогонах різні, діалог про це попередить окремим рядком. Кнопку Promote я не натискаю, бо вона змінює агента."
**Say (s8-06):** "І ще чесне спостереження: два прогони четвертої версії дали recall п'ятдесят сім і вісімдесят три відсотки. Дешева модель недетермінована, тож висновок варто робити за кількома прогонами, а не за одним."

## 9. Skill evals - 65 s
**Show:** Skills → `corner-case-checklist` → tab Evals: case list, `Run all evals`, `via <agent>`, `Change agent`.
**Do:** hover `Run all evals` and `Change agent`; open a row's edit action to show the same Case Editor titled with the skill name; close with Cancel.
**Say (s9-01):** "Те саме працює для скіла. Скіл, який я написав раніше, жив без регресійного захисту: будь-яка правка опису могла тихо зламати його поведінку."
**Say (s9-02):** "Тепер у скіла є власна вкладка Evals з власним набором кейсів. Скіл сам не рев'юїть, тому прогін іде через агента, якого я обираю, і вибір запам'ятовується."
**Say (s9-03):** "У запису прогону фіксуються версія скіла і версія агента. Тож правку скіла можна перевірити цифрами, а не через тиждень на дивному рев'ю."

## 10. Wrap-up - 30 s
**Show:** `/evals` dashboard again.
**Do:** none.
**Say (s10-01):** "Підсумок: кейс зі знахідки одним кліком, ручний Case Editor, скоринг без моделі, дашборд із трендом і порівняння двох промптів."
**Say (s10-02):** "Усе покрито тестами та одним скриптом verify l06, який я прогнав перед записом. Дякую."

## Coverage
| Criterion (HW L06) | Scene | Cue |
|---|---|---|
| Case from a finding in one click; accepted -> must_find, dismissed -> must_not_flag | 2 | s2-02, s2-03 |
| See all cases of the agent's set | 3 | s3-01, s3-02 |
| Run the agent on all cases | 3 | s3-03 |
| Metrics recall / precision / citation_accuracy | 5 | s5-03, s5-04 |
| Scoring with no LLM call | 5 | s5-01, s5-02 |
| Run history, compare two runs (old vs new prompt) | 7, 8 | s7-04, s8-01..s8-03 |
| Prompt change visibly moves recall/precision; deliberate break drops precision | 8 | s8-04 |
| Eval Dashboard page in the left sidebar, latest runs | 6 | s6-01 |
| Set has >= 8 cases | 3 (prep) | s3-02 (not quoted as a number) |
| `pnpm verify:l06` green | 10 | s10-02 (claim, run it before filming) |
| Stretch: Case Editor | 4 | s4-01..s4-06 |
| Stretch: trend chart (point = run, tooltip = version + cost) | 7 | s7-01, s7-02 |
| Stretch: skill evals | 9 | s9-01..s9-03 |

## Unverified claims
- s10-02 "verify l06 passed" is true only after `pnpm verify:l06` is run (needs Docker); not on screen.
- s5-01 "scoring has no LLM call" is a code fact (`server/src/domain/evals/scoring.ts`); no frame shows it.
- s2-03 (dismissed -> must_not_flag) is said but not shown: PR #20 has no dismissed finding; the two
  must_not_flag cases on screen in s3 are manual ones.
- s4/s9 single-case `Run case` result (passed / failed) is model output and is not quoted.
- Rendered dates are local time; they are not narrated.
- Timings are estimates: narration chars / 14 per second plus gaps.
