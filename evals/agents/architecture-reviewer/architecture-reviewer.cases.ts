import type { AgentCase } from "../../src/index.js";
import { fixtureReader } from "../../src/index.js";

const fx = fixtureReader(import.meta.url);

const REVIEW_PROMPT = `Audit this diff against DevDigest's documented structural contracts.

${fx("checkout-service.diff")}`;

// A second real diff whose violations map onto DevDigest-SPECIFIC written rules (the purity rule
// in reviewer-core/CLAUDE.md and the groundFindings gate in reviewer-core/docs/pipeline.md) that a
// competent model will describe in prose but will not spontaneously cite unless the agent forces a
// citation. This is the discriminating case for the strict-vs-lite A/B: both variants should FIND
// both problems, but only the strict variant (which keeps the "name the written rule per finding"
// hard rule) should reliably cite the source. The checkout diff's textbook violations discriminate
// less — the arch:check rule names are easy to volunteer either way.
const REVIEWER_CORE_PROMPT = `Audit this diff against DevDigest's documented structural contracts.

${fx("reviewer-core-gate.diff")}`;

// A diff that violates NO documented rule (a pure local-variable rename inside a domain file, no
// new imports, no cross-layer edges). A grounded reviewer should report zero violations. This
// surfaces the COST of relaxing the citation rule: freed from "every finding must name a
// documented contract", the lite variant is more prone to fabricating a judgment/best-practice
// finding where the strict variant stays silent.
const BENIGN_PROMPT = `Audit this diff against DevDigest's documented structural contracts.

${fx("benign-refactor.diff")}`;

// Shared across the strict (architecture-reviewer) and relaxed (architecture-reviewer-lite)
// variants so the two agents are graded on the exact same task — the only thing that should
// move between the two runs is whether "cites the specific documented rule" keeps passing.
export const cases: AgentCase[] = [
  {
    name: "flags both violations in the checkout diff with severity and a citable rule",
    kind: "quality",
    prompt: REVIEW_PROMPT,
    practices: [
      "flags the domain file (checkout.ts) importing a type from 'fastify' as a violation of the rule that only the presentation ring and the composition root may know Fastify (inward-only dependencies between rings)",
      "flags the `new PgCheckoutRepository()` call inside service.ts as a violation of DI discipline (implementations are chosen and constructed only in the composition root / container, platform/container.ts)",
      "names a specific documented rule for EVERY finding — an `arch:check` rule name (e.g. `no-framework-below-routes`), an onion-architecture section, or a precheck signal (e.g. `construct-in-service`) — rather than describing the problem only in prose",
      "assigns a severity (e.g. CRITICAL/MAJOR/MINOR/NIT or critical/high/medium/low) to each finding",
      "quotes the offending line verbatim as evidence for each finding, not a paraphrase",
      "ends with an explicit gate verdict (PASS/BLOCKED or PASS/FAIL) based on the severity of the findings",
    ],
    threshold: 1.0,
    maxTurns: 25,
  },
  {
    name: "does not fabricate an architecture finding for the out-of-scope security-shaped change",
    kind: "quality",
    prompt: REVIEW_PROMPT,
    practices: [
      "does not invent an architecture-contract violation for the optional `reply?: FastifyReply` parameter beyond the Fastify-import-in-domain issue itself (no runtime bug/security finding fabricated as an architecture rule)",
      "stays scoped to structural/layering/DI findings and does not comment on naming, style, or test coverage",
    ],
    threshold: 1.0,
    maxTurns: 25,
  },
  {
    name: "cites the DevDigest-specific rule identifier for reviewer-core violations",
    kind: "quality",
    prompt: REVIEWER_CORE_PROMPT,
    practices: [
      "flags the `import { readFileSync } from 'node:fs'` (and the readFileSync call) added to reviewer-core/src/review/run.ts as a violation (reviewer-core must do no I/O except the injected LLMProvider)",
      "flags that reviewPullRequest now returns `merged.findings` directly, removing the mandatory `groundFindings()` citation-grounding gate before emitting findings",
      "cites the documented reviewer-core purity rule (reviewer-core/CLAUDE.md, 'Purity is the point': no filesystem access, the only side effect is the injected LLMProvider) for the fs-import finding rather than only describing it in prose",
      "cites a written source for the mandatory grounding gate (reviewer-core/specs/review-contract.md § Grounding, reviewer-core/CLAUDE.md 'Grounding is one shared gate', or reviewer-core/docs/pipeline.md) for the skipped-gate finding rather than only describing it in prose",
      "quotes the offending line verbatim as evidence for each finding, not a paraphrase",
      "ends with an explicit gate verdict (PASS/BLOCKED or PASS/FAIL) based on the severity of the findings",
    ],
    threshold: 1.0,
    maxTurns: 25,
  },
  {
    name: "does not fabricate a documented-rule violation for a benign rename",
    kind: "quality",
    prompt: BENIGN_PROMPT,
    practices: [
      "reports no violations for the benign rename (or records only NIT/info-level, non-blocking observations) — it does not invent a CRITICAL/MAJOR/MINOR (critical/high/medium) finding",
      "does not fabricate a documented-rule violation where the diff violates none of the checked rules",
      "the final gate verdict is PASS",
    ],
    threshold: 1.0,
    maxTurns: 25,
  },
];
