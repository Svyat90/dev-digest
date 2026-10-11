import type { WorkflowCase } from "../src/index.js";

/**
 * Systemic ("workflow") tier — asserts the real on-disk harness (CLAUDE.md + skills + subagents,
 * loaded via settingSources:["project"]) behaves as documented. Organized by scenario, not by a
 * single artifact, because these behaviors are cross-cutting.
 *
 * Budget: 7 Claude sessions total.
 *   - 5 × trace     → 1 session each                      = 5
 *   - 1 × activation pair (positive + near-miss negative) = 2
 *
 * `trace` folds several assertions into ONE session (cheaper, coarser) and stops early once its
 * evidence is in — or as soon as its expected subagent is dispatched, so a dispatch-bearing trace
 * never waits out the nested subagent's full run. Trace asserts are soft: one run reports every
 * missed read, not just the first. Only merge reads that already pass reliably on their own —
 * per-read flakiness multiplies inside one case.
 */
export const cases: WorkflowCase[] = [
  // --- trace (1 session): server module + DI — nested server/CLAUDE.md routing -----------------
  // server/CLAUDE.md › "Read README.md before adding a route" and "docs/architecture.md before
  // adding a module / touching the DI container". Kept apart from the contract rule: in one prompt
  // the model reliably did one of the two jobs and dropped the other's docs. One rule per trace.
  // Nested CLAUDE.md files are asserted through the docs ONLY they route to, never as an explicit
  // Read: Claude Code auto-loads them, so a direct `Read server/CLAUDE.md` happens only in some runs.
  {
    kind: "trace",
    name: "server module task follows server/CLAUDE.md routing to README.md and docs/architecture.md",
    prompt:
      "Я планую новий модуль `exports` у server з ендпоінтом GET /reviews/:id/export (ще не " +
      "реалізований) і реєстрацією його сервісу в DI-контейнері. Код не пиши і сабагентів не запускай. " +
      "За настановами цього репо (root і server/CLAUDE.md) прочитай документи, які треба прочитати " +
      "перед таким завданням.",
    expectFilesRead: ["server/README.md", "server/docs/architecture.md"],
    maxTurns: 12,
  },

  // --- trace (1 session): root rule "a contract change means checking both copies" --------------
  // client/src/vendor/shared is a drifted copy of the canonical server one; reading only one side
  // is exactly the trap the root CLAUDE.md warns about.
  {
    kind: "trace",
    name: "contract change opens both the canonical and the client copy of shared contracts",
    prompt:
      "Хочу додати поле `reviewedAt` у контракт findings. Код не змінюй — за настановами цього репо " +
      "визнач, які саме файли контракту треба звірити перед зміною, і прочитай їх.",
    expectFilesRead: ["server/src/vendor/shared/contracts/findings.ts", "client/src/vendor/shared/contracts/findings.ts"],
    maxTurns: 10,
  },

  // --- trace (1 session): client side — nested client/CLAUDE.md routing ------------------------
  // ui-architecture.md is routed ONLY from client/CLAUDE.md, so reading it proves the nested file
  // took effect, not just the root one.
  {
    kind: "trace",
    name: "client screen task follows client/CLAUDE.md routing to ui-architecture.md",
    prompt:
      "Хочу додати в client новий екран зі списком імпортованих репозиторіїв і окремий data hook для " +
      "нього. Код не пиши — спершу за настановами цього репо (root і client/CLAUDE.md) прочитай " +
      "документи, які треба прочитати перед таким завданням.",
    expectFilesRead: ["client/docs/ui-architecture.md"],
    maxTurns: 10,
  },

  // --- trace (1 session): route routing + subagent dispatch -------------------------------------
  // Kept separate from the full-stack case: dispatch ends the session (see stopWhen), so it must
  // be the last expectation of a short case. Also proves the root rule "read the routed doc BEFORE
  // dispatching": a README read after the dispatch never counts.
  // The endpoint must NOT already exist, or the model reviews existing code inline instead of
  // planning-then-dispatching. GET /reviews/:id/export is genuinely absent from routes.ts.
  {
    kind: "trace",
    name: "API-route task reads server/README.md AND pulls the architecture-reviewer",
    prompt:
      "Я планую додати НОВИЙ, ще не реалізований ендпоінт GET /reviews/:id/export (віддає ревʼю як " +
      "markdown). Спершу звірся з конвенціями API цього репо. Потім ОБОВʼЯЗКОВО запусти сабагента " +
      "architecture-reviewer, щоб він оцінив мій план на відповідність onion-шарам — не рецензуй сам.",
    expectFilesRead: ["server/README.md"],
    expectSubagents: ["architecture-reviewer"],
    maxTurns: 8,
  },

  // --- trace (1 session): reviewer-core — pipeline routing + trap lookup in INSIGHTS.md ---------
  // Merges two former sessions: reviewer-core/CLAUDE.md › "Read docs/pipeline.md" for a pipeline
  // change, and the root session protocol / reviewer-core/CLAUDE.md › traps live in INSIGHTS.md.
  {
    kind: "trace",
    name: "reviewer-core task reads pipeline.md and checks INSIGHTS.md for the surprise",
    prompt:
      "Я збираюся змінити review pipeline у reviewer-core і вже стикнувся там з несподіваною " +
      "поведінкою — щось працює не так, як я очікував. Код не чіпай. За настановами цього репо прочитай " +
      "документацію, яку треба прочитати перед змінами в pipeline, і файл, де така поведінка вже могла " +
      "бути задокументована.",
    expectFilesRead: ["reviewer-core/docs/pipeline.md", "reviewer-core/INSIGHTS.md"],
    maxTurns: 15,
  },

  // --- activation pair (2 sessions): positive + near-miss negative ------------------------------
  {
    kind: "activation",
    name: "engineering-insights activates on a genuine discovery",
    prompt:
      "Щойно з'ясував, чому pgvector-запит повертав нуль рядків — розмірність колонки не збіглася " +
      "після зміни моделі ембедингів. Хочу це зафіксувати, щоб більше не наступати.",
    skill: "engineering-insights",
    shouldActivate: true,
    maxTurns: 4,
  },
  {
    kind: "activation",
    name: "near-miss negative — explaining the same topic must NOT record an insight",
    prompt:
      "Поясни, як у pgvector працюють розмірності колонок і чому невідповідність повертає нуль рядків.",
    skill: "engineering-insights",
    shouldActivate: false,
    maxTurns: 4,
  },
];
