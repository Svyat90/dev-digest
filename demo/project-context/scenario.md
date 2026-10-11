# Demo devdigest-project-context — shooting script (L05: Project Context + PR Brief)

About 4.5–5 min: 3208 characters of narration, ≈ 229 s at 14 characters/second, plus
the pauses for clicks and the cut generation wait. Narration is Ukrainian, for the course
mentor who grades homework L05. The scenario stays English (root `CLAUDE.md` › Language);
only the `Say` lines are Ukrainian.

Sources of truth: the course brief for the PR Brief video (six steps, pasted by the
author 2026-10-05, plus "the PR description carries a short cross-model review note"),
`specs/01-project-context-2026-10-03.md` (SPEC-01), `specs/02-context-injection-2026-10-03.md`
(SPEC-02) and `specs/03-pr-brief-2026-10-04.md` (SPEC-03).

## Assumptions

- Length ≈ 5 min (confirmed by the author). The Project Context part is cut to ≈ 1.5 min
  (old s1+s2 → s1, old s3 → s2, old s4 → one sentence in s2-03, old s5–s7 → s3). The skill
  inheritance view, the 12,000-token cap and the Live Log are no longer shown.
- One test PR serves both parts: **`Svyat90/dev-digest#20`** (`feature/l05-demo-workspace-override`),
  studio PR id `c4f0b936-c09c-4691-8105-7fa45cbc5654`. It has deliberate defects: `NotFoundError`
  returns 400 instead of 404, its signature change leaves the old call sites producing
  "Repo not found not found", the new `GET /agents/:id/run-count` route queries the db, and a
  thin unit test. Never merge it.
- Generate brief **is clicked on camera** (confirmed). The s4 pre-roll deletes the stored
  brief, so every take costs one model call (≈ 8k tokens in, ≈ 3k out, ≈ 30–45 s on
  openrouter `deepseek/deepseek-v4-flash`). The wait is cut in editing.
- The brief is model output and changes on every take: the narration never quotes a risk
  title, a risk count, a severity mix or a focus-item count.
- The process scene (s8) is filmed on github.com (PR #19, merged), in the same browser.
- Display: pass `--display-id=<id>` of the secondary external to preflight
  (`devdigest-demo`; ids change on re-plug).

## Preparation (done 2026-10-05 — re-check before filming)

> Filmed 2026-10-05; afterwards PR #21 (`server/specs/layering.md` + its README row) was
> reverted on `main`. To re-shoot s1–s3 or s6, put `prep/layering.md` back at
> `server/specs/layering.md` on `main` and resync the studio (step 1).

1. `server/specs/layering.md` is on `main` (PR #21, merged) and the studio clone is synced
   to `2a8eba1` with a **full** index. After a resync the index can come back `partial`
   (the incremental indexer trips on files deleted on `main`, ENOENT); the Blast radius
   card then shows a degraded notice. Fix: delete the repo's `repo_index_state` row and
   `POST /repos/562ddc32-…/resync` — with no state row the indexer runs a full index.
2. PR #20 is open; its studio row has head `5d608c8`. `POST /repos/:id/refresh` does NOT
   update a PR's `head_sha`; `GET /repos/:id/pulls` does. A stale head makes the brief
   "Out of date" and the intent "PR updated — intent stale".
3. PR #20's description holds no links. Every `*.md` path or `https` URL in it becomes an
   intent source, and one that cannot be read shows as "unavailable" on the Intent card.
4. Reviews on PR #20 at `5d608c8`: General Reviewer (with `layering.md` attached) —
   request_changes, 5 findings, 3 critical, one of them cites `server/specs/layering.md`;
   API Contract Reviewer — 1 critical; Test Gap Reviewer — 2 warnings + 1 suggestion.
   Do not re-run them: the verdict line in s5 quotes the current state.

## Preconditions

- App running from `main` (`./scripts/dev.sh`): web :3000, API :3001.
- Active repo `Svyat90/dev-digest`, id `562ddc32-33fe-4292-8ec5-83cc6bb2e528`
  (`localStorage['dd-repo']` set in every pre-roll — `client/INSIGHTS.md` 2026-09-23).
- Ids: General Reviewer `6f6e2eb2-b04c-4e37-8ed7-52f34bf52ccf`; PR #20 `c4f0b936-c09c-4691-8105-7fa45cbc5654`.
- Never click: `Delete agent`, `Delete this review run`, `Delete skill`, `Remove`, and in this
  video also `Run Review`, `Delete run`, `Refresh` (the brief's — it regenerates and costs a
  call), `Recompute` (intent) and the `Attach to…` options (open/close only).

## s1 — Project Context page (≈ 35 s)

- **Show:** `/repos/562ddc32-…/context`: heading `Project context in Svyat90/dev-digest`, the
  list with type tags and `≈ N tokens`, rows marked `truncated` (13 of 65 today).
- **Do:** point at the `Project Context` sidebar item; slow scroll to a `truncated` row; type
  `layering` in `Filter by path…`; click `server/specs/layering.md`; point at the
  `Invariant L1` heading in the preview; point at `Used by 1 agents · 0 skills`.
- **Say:**
  - s1-01: «П'ята домашка, дві фічі: Project Context і PR Brief. Почнемо з Project Context — це всі markdown-документи репозиторію, які можна прикріпити до агентів і скілів.»
  - s1-02: «Тут шістдесят п'ять документів: шлях, тип і розмір у токенах. Позначка truncated означає, що документ довший за чотири тисячі токенів і в промпт піде лише його початок.»
  - s1-03: «Фільтрую за шляхом: layering. Preview показує інваріант — роут не імпортує db напряму. А зверху видно, що документ уже використовує один агент.»

## s2 — Agent Context tab (≈ 30 s)

- **Pre-roll:** `PUT /agents/6f6e2eb2-…/context-docs {"paths":["server/specs/layering.md"]}`.
- **Show:** `/agents/6f6e2eb2-…?tab=context`: `1 of 65 attached`, `Total ≈ 312 tokens`, the
  checked row `server/specs/layering.md`.
- **Do:** tick `Attach server/docs/architecture.md` → `2 of 65 attached`, total grows by
  2,640; untick it → back to `1 of 65`.
- **Say:**
  - s2-01: «Вкладка Context в агента General Reviewer: прикріплено один документ із шістдесяти п'яти — той самий layering.md.»
  - s2-02: «Ставлю галочку на architecture.md — лічильник і загальний обсяг у токенах оновлюються одразу. Знімаю — і знову один документ.»
  - s2-03: «В агенті зберігається лише шлях, а текст читається під час прогону з default branch. У скілів така сама вкладка, і агенти успадковують їхні документи.»

## s3 — The violating PR and its trace (≈ 35 s)

- **Show:** `/repos/562ddc32-…/pulls/20?tab=findings` (tab label `Agent runs 11`), the newest
  `General Reviewer` row (`rejected`, `1 · 3 blockers`), button `Open run trace & logs` →
  drawer `Agent run · General Reviewer PR #20 · completed`. Configuration:
  `Specs read server/specs/layering.md ≈ 312 tokens`. `Findings 5`, the third one
  `CRITICAL Route directly queries the database, violating layering rules
  server/src/modules/agents/routes.ts:126-132`, whose text names `server/specs/layering.md`.
  `Prompt assembly` (expand the project context block: `## Project context` /
  `<untrusted source="server/specs/layering.md">`). `Tool calls 1 review_file(all files) single-pass`.
- **Do:** open the drawer (s3-01); point at Specs read, then scroll to the layering finding
  (s3-02); in the pause before s3-03 expand Prompt assembly and its project context block so
  the `<untrusted source=…>` text is on screen; scroll to Tool calls during s3-03.
- **Audio note:** s3-03 is the last sentence cut from an earlier take of the cue (ElevenLabs
  quota ran out, 2026-10-05): the untrusted block is shown, not narrated. Re-generate
  s3-02/s3-03 when the quota resets if the author wants it spoken.
- **Say:**
  - s3-01: «Тестовий PR номер двадцять: новий ендпоїнт run-count ходить у базу прямо з роута. Відкриваю trace прогону General Reviewer.»
  - s3-02: «У Configuration, в рядку Specs read — server/specs/layering.md. А серед п'яти findings є критичний: роут звертається до бази напряму, з посиланням саме на layering.md.»
  - s3-03: «Окремого виклику моделі немає — у Tool calls один виклик.»

## s4 — Generate brief (≈ 17 s + cut wait)

- **Pre-roll:** `docker exec devdigest-postgres psql -U devdigest -d devdigest -c "delete from pr_brief where pr_id='c4f0b936-c09c-4691-8105-7fa45cbc5654'"`.
- **Show:** `/repos/562ddc32-…/pulls/20?tab=overview`: block `PR Brief` with the verdict line
  `Request changes 5 findings · 3 blockers General Reviewer`, the empty state `No brief for this
  PR yet` and the button `Generate brief`.
- **Do:** hover `Generate brief`, click it during s4-01; hold on the generating state during
  s4-02; wait for heading `Risk areas` (timeout 300 s) — cut the wait in editing.
- **Say:**
  - s4-01: «Друга фіча — PR Brief. Той самий PR, вкладка Overview. Брифу ще немає, є кнопка Generate brief. Натискаю.»
  - s4-02: «Це рівно один виклик моделі з фіксованим бюджетом токенів. Поки він триває, блок показує стан генерації; очікування я вирізав.»

## s5 — The brief (≈ 40 s)

- **Show:** the generated block top to bottom: verdict line and `PR SCORE`; the summary
  paragraph with `Generated <date>`; `Intent` card (blockquote, `In scope`, `Confidence: Medium`,
  Sources `Description`, `Diff outline`); `Risk areas` (each with a severity tag and
  `file:start-end` buttons); `Blast radius` — `symbols 7 · callers 45 · endpoints 21 · cron/jobs 0`,
  tree view; `Review focus — read these first N`.
- **Do:** s5-01 verdict line → summary; s5-02 scroll down to `Risk areas`, hover a risk's
  `file:lines` button, open one risk with `Show explanation: …` and close it; s5-03 scroll up to
  the Intent card, then down past Risk areas to the Blast radius stats; s5-04 scroll past the
  Blast tree to Review focus. (Intent sits above Risk areas on screen; the cue order follows
  the recorded audio.)
- **Say:**
  - s5-01: «Готово. Зверху — вердикт останнього рев'ю: Request changes, п'ять findings, три блокери. Під ним короткий підсумок: що робить PR і з чого почати.»
  - s5-02: «Risk areas: кожен ризик має рівень, пояснення і посилання на файл та рядки.»
  - s5-03: «Далі Intent: навіщо цей PR, що в скоупі і з яких джерел це взято. І Blast radius: сім символів, сорок п'ять викликів, двадцять один ендпоїнт — NotFoundError використовується по всьому API.»
  - s5-04: «Внизу Review focus — рекомендований порядок читання: файл, рядок і чому варто почати саме звідти.»

## s6 — Review focus → Files changed (≈ 20 s)

- **Show:** after the click, `?tab=diff&file=server%2Fsrc%2Fmodules%2Fagents%2Froutes.ts&line=125`:
  group `Core`, the row `125 return { ok: true };` outlined (`aria-current=location`, top ≈ 252 px
  at 1600×1000 — below the sticky headers), and right under it the `BLOCKER` finding
  `Route directly queries the database, violating layering rules` citing `server/specs/layering.md`.
- **Do:** click the Review focus item whose name starts `server/src/modules/agents/routes.ts:`
  followed by ` — ` (the risk-ref buttons share the `routes.ts:125` prefix, so match the ` — `).
  If this take's brief has no `agents/routes.ts` item, click the first focus item and use the
  fallback line below.
- **Say:**
  - s6-01: «Клікаю пункт Review focus для agents/routes.ts — і відкривається Files changed саме на цьому файлі, потрібний рядок підсвічено.»
  - s6-02: «Одразу під ним finding рев'юера з позначкою blocker — те саме порушення layering. Бриф веде до місця, а рев'ю пояснює, що там не так.»
  - fallback for s6-01 (no `agents/routes.ts` item): «Клікаю перший пункт Review focus — і відкривається Files changed саме на цьому файлі, потрібний рядок підсвічено.»

## s7 — Reload (≈ 12 s)

- **Show:** `/repos/562ddc32-…/pulls/20?tab=overview`, then the browser reload; the brief
  is back with the same `Generated …` time and no `Out of date` badge.
- **Do:** go back to Overview; reload; point at `Generated …`.
- **Say:**
  - s7-01: «Перезавантажую сторінку. Бриф на місці одразу, без нової генерації: він зберігається разом із комітом, який описує. Новий коміт у PR позначить його як Out of date.»

## s8 — How it was built: PR #19 (≈ 45 s)

- **Show:** `https://github.com/Svyat90/dev-digest/pull/19` (merged), Conversation tab, the
  description's `### Process artifacts` list: Spec, Plan, **Cross-model review** (Claude Opus
  plan reviewed by ChatGPT free tier, ~8/10, no AC uncovered, accepted findings in plan rev. 2),
  **plan-verifier** (MET 40 …). Then Files changed:
  - spec: `https://github.com/Svyat90/dev-digest/pull/19/files#diff-09569a22a8d2bdebacd269175765bddfdc7fe758ddb8e54ccd4cc250c3775138`
    (`specs/03-pr-brief-2026-10-04.md`, 223 lines; `## Acceptance criteria (EARS)` at line 87, AC1–AC27);
  - plan: `https://github.com/Svyat90/dev-digest/pull/19/files#diff-cefafe11600a73f047a00e0ba9e416e9ae0ebe27ce4dda4d97b543aa1bf1388d`
    (`docs/plans/2026-10-04-pr-brief.md`, 944 lines; GitHub may collapse it — "Load diff").
  - Checks table: `https://github.com/Svyat90/dev-digest/blob/main/docs/plans/2026-10-04-pr-brief.md?plain=1#L930-L933`
    (`### Checks`, round 0: architecture-reviewer `PASS (0 findings …)`, plan-verifier
    `GAPS (MET 40 · PARTIAL: … · UNVERIFIABLE 4)`, open items `all closed: …; known gaps: …`).
- **Do:** scroll the description to Process artifacts, highlight the Cross-model review bullet;
  jump to the spec anchor, scroll to the EARS ACs; jump to the plan; open the Checks link.
- **Say:**
  - s8-01: «Як це будувалось. PR дев'ятнадцять: в описі є spec, plan, нотатка cross-model review і результат plan-verifier.»
  - s8-02: «Cross-model review: план, написаний Claude Opus, перевіряв ChatGPT від OpenAI. Оцінка близько восьми з десяти, жоден критерій не пропущено, а прийняті зауваження увійшли в другу ревізію плану.»
  - s8-03: «Spec — двадцять сім критеріїв приймання у форматі EARS. Plan — шістнадцять задач у п'яти хвилях.»
  - s8-04: «У кінці плану, в Execution log, таблиця Checks: architecture-reviewer — PASS, plan-verifier — сорок пунктів MET, а відкриті пункти закрито або записано як відомі прогалини.»

## s9 — Why facts, not the diff (≈ 12 s)

- **Show:** back on PR #20 Overview, the PR Brief block in full view.
- **Say:**
  - s9-01: «І чому модель брифу отримує готові факти, а не код diff: факти вже стислі й обмежені бюджетом, а diff необмежений і недовірений — його читають агенти рев'ю. Дякую за увагу.»

## Coverage

| Criterion | Scene | Cue |
|---|---|---|
| PR Brief 1 — open the test PR → Overview → show and press Generate brief | 4 | s4-01 |
| PR Brief 2 — the brief: summary, Risk areas, Review focus, Intent, Blast radius | 5 | s5-01…s5-04 |
| PR Brief 3 — click a Review focus item → Files changed on that file | 6 | s6-01 |
| PR Brief 4 — reload → the brief is there, no new generation | 7 | s7-01 |
| PR Brief 5 — show spec.md, plan.md and the plan-verifier report in the PR | 8 | s8-01, s8-03, s8-04 |
| PR Brief 6 — one sentence: why the model gets facts, not the diff | 9 | s9-01 |
| PR description carries a cross-model review note (which model, what it found) | 8 | s8-02 |
| One model call per brief (SPEC-03 AC2) | 4 | s4-02 |
| Project Context: attach repo markdown docs to agents and skills | 1, 2 | s1-01, s2-01, s2-03 |
| Per-document tokens, truncated at 4,000 (SPEC-01 AC17–18) | 1 | s1-02 |
| Filter, preview, Used by (SPEC-01 AC15–16) | 1 | s1-03 |
| Agent Context tab: checkbox, live counter and token total | 2 | s2-02 |
| Metadata stores paths, read at run time from the default branch | 2 | s2-03 |
| Trace: specs read; project context as untrusted; no separate LLM call | 3 | s3-02, s3-03 |
| Verification: invariant doc on main + violating PR + reviewer cites the doc | 3, 6 | s3-01, s3-03, s6-02 |

Not covered (cut for length): skill inheritance shown on screen (now one sentence, s2-03),
the order arrows, the 12,000-token cap warning, Live Log lines for missing documents,
the brief's Out of date badge on screen (only said, s7-01), the latest-verdict P3 is shown
but not explained.

## Unverified claims

- **The brief's content** (summary text, risks, focus items) is model output and differs per
  take. Checked twice on 2026-10-05: 3 risks (High/Medium/Low) and 3–4 focus items, both
  times including an `agents/routes.ts:125` focus item — not guaranteed; s6 has a fallback.
- **Generation time** 31 s (UI) and 42 s (API) on 2026-10-05; the s4 wait is cut, not narrated.
- **"Out of date after a new commit"** (s7-01): true per SPEC-03 and `brief/service.ts:386`
  (`stale: rec.head_sha !== pull.headSha`), not shown on screen.
- **"read at run time from the default branch"** and **"agents inherit skill documents"**
  (s2-03): true per SPEC-02 AC1 and SPEC-01 AC13, not shown on screen.
- **"fixed token budget"** (s4-02): 8,000 tokens per SPEC-03 AC5, not shown on screen.
- **"27 EARS criteria", "16 tasks in 5 waves"** (s8-03): counted in the spec (AC1–AC27) and in
  the plan's task list / Execution log; the frame shows the files, not the counts.
- **Counts that drift**: 65 documents / 13 truncated (changes with any `.md` merged to
  `main`), `Agent runs 11`, `Request changes 5 findings · 3 blockers` (changes if a review is
  re-run), Blast `7 · 45 · 21` (changes on reindex). Re-read all of them before filming.
