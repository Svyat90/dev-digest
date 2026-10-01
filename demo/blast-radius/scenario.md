# Demo devdigest-blast-radius — shooting script

About 2.5 min (1761 characters of narration, about 126 s at 14 characters/second, plus the
pauses for clicks). Narration is Ukrainian, for the course mentor who grades homework L04
(Blast Radius). The scenario files stay English (root `CLAUDE.md` › Language); only the
`Say` lines are Ukrainian. Sources of truth: `server/specs/blast-radius.md`, in particular
the *Acceptance criteria → where* table, and the plan `docs/plans/2026-09-30-blast-radius.md`.

## Assumptions

- Narration language and audience: Ukrainian, mentor (confirmed by the author).
- Length 2–3 min (confirmed). Browser only (`config.surfaces`); the MCP tool is mentioned
  in words, never shown in a terminal (confirmed).
- Mutating controls: only expanding **Prior PRs** is allowed (a read: one `GET /pulls/:id/history`).
  **Resync index** is hovered, never clicked (confirmed). No pre-roll is needed because nothing
  on the path changes data.
- The test PR is an existing one from before the MCP lab: **#12** `Feature/l03 smart diff`
  in `Svyat90/dev-digest`, the PR right before #13 `Feature/l04 mcp server`.
- Display: pass `--display-id=<id>` of the secondary external to the preflight, as in
  `devdigest-demo` (ids change on re-plug).

## Preconditions

- App running from `feature/l04-blast-radius` (`./scripts/dev.sh`): web :3000, API :3001.
- Index of `Svyat90/dev-digest` is `status: "full"` at `c6af1e4` (checked 2026-10-01 through
  `GET /repos/562ddc32-33fe-4292-8ec5-83cc6bb2e528/index-state`).
- Pages:
  - main: `/repos/562ddc32-33fe-4292-8ec5-83cc6bb2e528/pulls/12`, tab **Overview**;
  - empty state: `/repos/562ddc32-33fe-4292-8ec5-83cc6bb2e528/pulls/7`;
  - degraded: `/repos/1bc6b1c6-ad8a-4e58-8c2f-db1802582da7/pulls/482` (seed repo `acme/payments-api`).
- Never click: `Delete agent`, `Delete this review run`, `Delete skill`, `Remove`, and in this
  video also **Resync index**.

## s1 — The card on the Overview tab (≈ 16 s)

- **Show:** `/repos/…/pulls/12`, Overview. Intent card on the left, **Blast radius** card on
  the right, both fully loaded.
- **Do:** none. Hold the frame so both cards are visible.
- **Say:**
  - s1-01: «Четверта домашка — Blast Radius. Це вкладка Overview для PR номер дванадцять, і поруч із Intent тепер є картка Blast radius: що зачепить ця зміна.»
  - s1-02: «Для кожного символу, оголошеного у змінених файлах, вона показує, хто його викликає, і які ендпоїнти та крони лежать у файлах цих викликачів.»

## s2 — Summary row and tree (≈ 25 s)

- **Show:** the summary row, then the collapsible tree. On screen: `26 symbols`, `21 callers`,
  `22 endpoints`, `0 cron/jobs`. The first group `useRunReview` (`1 callers`) is open with
  `client/src/app/repos/[repoId]/pulls/[number]/_components/RunReviewDropdown/RunReviewDropdown.tsx:37`
  and the caller name `RunReviewDropdown`. The next groups are collapsed: `useFindingAction`,
  `useRunEvents`, `chevronFor`, …
- **Do:** point at the summary row; then hover the `file:line` link of the open group (do
  not click it: it opens GitHub in a new tab).
- **Say:**
  - s2-01: «Зверху підсумок: двадцять шість символів, двадцять один виклик, двадцять два ендпоїнти і нуль крон.»
  - s2-02: «Нижче дерево: одна згортана група на символ, групи впорядковані за рангом файлу викликача. Перша група відкрита, решта згорнуті.»
  - s2-03: «Кожен виклик — це файл і рядок, і посилання відкриває саме цей рядок на GitHub, на тому коміті, який проіндексовано.»

## s3 — Endpoints and crons (≈ 18 s)

- **Show:** the group `deriveReviewStatus` expanded: `2 callers`, callers
  `server/src/modules/pulls/routes.ts:146` (`pullsRoutes`) and
  `server/test/pulls-status.test.ts:47`, then endpoint chips `GET /repos/:id/pulls` and
  `GET /pulls/:id` (globe icon). No cron chip exists in this PR.
- **Do:** click the header **Expand deriveReviewStatus** (aria-label); optionally collapse
  `useRunReview` first so the page does not scroll. Leave it open for s4.
- **Say:**
  - s3-01: «Розкриваємо deriveReviewStatus: два викликачі, а під ними чипи ендпоїнтів, які живуть у файлах цих викликачів.»
  - s3-02: «Крони показуються окремо від ендпоїнтів, іншим кольором. У цьому PR їх нуль, тому чипів крон тут немає.»

## s4 — Graph view (≈ 10 s)

- **Show:** the **Tree | Graph** toggle in the summary row, then the SVG `Blast radius graph`:
  changed symbols on the left, callers in the middle, endpoints on the right, a dashed
  `+3 more` style node where a column is capped, legend `changed symbol` / `callers` /
  `endpoints affected`.
- **Do:** click **graph** (`aria-pressed`), hold about 4 s, click **tree** to restore.
- **Say:**
  - s4-01: «Перемикач Graph показує ту саму мапу графом: символи ліворуч, викликачі посередині, ендпоїнти праворуч, а надлишок згортається в плюс N more.»

## s5 — Prior PRs footer (≈ 18 s)

- **Show:** the collapsed footer **Prior PRs touching these files**, then expanded: count
  badge `0 PRs` and the text `No merged PRs touched these files.`
- **Do:** scroll the card into view; click **Show prior PRs touching these files**; hold.
- **Say:**
  - s5-01: «Знизу — згорнутий блок Prior PRs. Він вантажиться лише при першому розкритті, без моделі: історія файлів із локального клону і пошук злитих PR на GitHub.»
  - s5-02: «Тут порожньо, і це чесно: локальний клон цього репозиторію містить лише один коміт, тож історії для пошуку немає.»

## s6 — Empty and degraded states (≈ 20 s)

- **Show:** first PR #7: the card reads `1 changed symbol(s), no downstream callers found.`
  (no stats, no tree). Then the seed PR #482 of `acme/payments-api`: badge **Partial data**,
  the sentence `This repository has no usable index yet. Callers come from a text search,
  and endpoints and crons are not attributed.`, the button **Resync index**, and
  `0 changed symbol(s), no downstream callers found.`
- **Do:** navigate to the PR #7 URL, hold; navigate to the PR #482 URL, hold; hover (do not
  click) **Resync index**.
- **Say:**
  - s6-01: «Якщо викликачів немає, це видно одразу: у PR номер сім один змінений символ і жодного викликача.»
  - s6-02: «А це репозиторій без індексу, seed-PR чотириста вісімдесят два: бейдж Partial data, причина і кнопка Resync index. Я її не натискаю — вона запускає реіндекс.»

## s7 — Under the hood and MCP (≈ 17 s)

- **Show:** back on `/repos/…/pulls/12`, the card in tree mode (still frame).
- **Do:** none.
- **Say:**
  - s7-01: «Усе це читання індексу, який repo-intel побудував під час клонування: без виклику моделі й без повторного парсингу, а відповідь валідується контрактом.»
  - s7-02: «Ті самі групи й підсумок віддає MCP-інструмент get_blast_radius для Claude Code, але тут я його не показую.»

## Checked against the screen (2026-10-01, branch `feature/l04-blast-radius`)

Read with Playwright `ariaSnapshot()` from the rendered pages, not from the API.

- PR #12 Overview: `symbols 26`, `callers 21`, `endpoints 22`, `cron/jobs 0`; toggle
  `tree [pressed]` / `graph`; 15 groups; first group `Collapse useRunReview [expanded]`;
  footer `Show prior PRs touching these files`.
- After opening it: `Prior PRs touching these files 0 PRs`, `No merged PRs touched these files.`
- Graph: `img "Blast radius graph"` with the first labels `useRunReview useFindingAction …`
  and a `+3 mo…` node; legend `changed symbol`, `endpoints affected`.
- PR #7: `Blast radius 1 changed symbol(s), no downstream callers found.`
- PR #482 (acme): `Partial data`, the `no_data` sentence, `Resync index`, `0 changed symbol(s), …`.
- API cross-checks: `deriveReviewStatus` has 2 callers and 2 endpoints
  (`GET /repos/:id/pulls`, `GET /pulls/:id`); `index_sha` is `c6af1e4`; `limits.max_callers_per_symbol` is 20.
- Clone: `git log --oneline | wc -l` is `1` in `server/clones/Svyat90/dev-digest`, so Prior PRs
  is empty for every PR of this repo, not only #12.

## Unverified claims

- «Без виклику моделі й без повторного парсингу» (s7-01) is true from the code and covered by
  `server/test/blast.it.test.ts` (throwing LLM doubles) and the log line `blast radius read`
  with `source: "index"`, but the frame proves none of it.
- «Відповідь валідується контрактом» (s7-01): true (`response: { 200: BlastRadiusResponse }`),
  not visible on screen.
- «Посилання відкриває рядок на проіндексованому коміті» (s2-03): the sha is in the href
  (`/blob/c6af1e4…/…#L37`); the video only hovers the link. Verify the href before filming.
- «Крони окремо, іншим кольором» (s3-02): there is no cron in any indexed PR here, so the
  orange cron chip is never on screen. It is covered by `BlastRadiusCard.test.tsx`.
- «Групи впорядковані за рангом» (s2-02): the order is visible, the rank itself is not.
- The MCP tool is mentioned, not shown, by decision.

## Product notes found while checking (for the author, not for the narration)

- **Prior PRs is always empty on this machine.** Every local clone is a single commit
  (`server/clones/**`, one commit each), so `git log -- <file>` returns nothing to look up.
  The feature works (unit and integration tests), but a demo with real prior PRs needs a clone
  with history. s5-02 states the empty state honestly instead of hiding it.
- **Stat label vs summary string.** The card's fourth stat reads `cron/jobs` (the existing
  `stat.crons` key), while the server summary and MCP say `crons`. The narration says «крон».
- The clone's `origin` remote URL embeds a GitHub token (`x-access-token:…`). It was printed
  once in a terminal session; consider rotating it and keeping credentials out of remotes.

## Coverage: spec criterion → scene → cue

| Criterion (spec › Acceptance criteria) | Scene | Cue |
|---|---|---|
| P1 card with summary row, callers and endpoints | s1, s2, s3 | s1-01, s2-01, s3-01 |
| P1 test PR with ≥ 2 real callers and ≥ 1 endpoint | s3 (`deriveReviewStatus`: 2 callers, 2 endpoints) | s3-01 |
| P1 `file:line` opens that line on GitHub | s2 | s2-03 |
| P1 clear empty state / partial-index badge with reason | s6 | s6-01, s6-02 |
| P1 working `get_blast_radius`, same map as the page | s7 (mentioned only) | s7-02 |
| P2 log shows the index read, no re-parse | **not shown** (see Unverified) | s7-01 (said) |
| P2 response validated by the contract | **not shown** | s7-01 (said) |
| P2 mapping unit-tested | **not covered**: add a sentence to s7 or show `blast-helpers.test.ts` | — |
| P2 no LLM in the main path | s7 | s7-01 |
| P2 declaring file not among its callers | **not covered** (BR3, unit-tested) | — |
| P2 limits from one constant, echoed to the client | **not covered** (no group reaches the cap here, so no limit hint) | — |
| P2 `degraded` + `reason` reach the UI | s6 | s6-02 |
| P2 MCP tool per the lab rules | s7 (mentioned only) | s7-02 |
| P3 collapsible tree | s2, s3 | s2-02, s3-01 |
| P3 crons apart from endpoints | s3 (stated; no cron data) | s3-02 |
| P3 rank order | s2 | s2-02 |
| P3 Resync button | s6 (hover, not clicked) | s6-02 |
| P3 i18n | **not covered**: only `en` exists; say it in one sentence if the mentor asks | — |
| P3 Prior PRs touching these files | s5 (empty state) | s5-01, s5-02 |
| Beyond the spec: Tree/Graph view | s4 | s4-01 |

Uncovered rows are deliberate for a 2–3 minute cut. Adding the P2 unit-test and self-file
sentences to s7 costs about 12 s; say if you want them.
