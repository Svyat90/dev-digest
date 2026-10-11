/**
 * CI change detector for the harness evals.
 *
 * Reads a newline-separated list of changed files (repo-relative) from $CHANGED_FILES and maps
 * them onto the eval suites that should run for this PR:
 *
 *   .claude/skills/<name>/**   OR  evals/skills/<name>/**   → run evals/skills/<name>  (content tier)
 *   .claude/agents/<name>.md   OR  evals/agents/<name>/**   → run evals/agents/<name>  (tool tier)
 *   any CLAUDE.md (root or nested), any agent, .claude/settings.json, .claude/hooks/**,
 *   evals/workflow/**                                       → run the workflow tier
 *
 * A change to the eval MACHINERY (evals/src/**, the proxy, the package manifest or lockfile, this
 * script, the harness-evals workflow) — or FULL=1 (manual dispatch) — runs every suite that has
 * evals: the measuring instrument changed, so every reading it produces is in question.
 *
 * A changed artifact with NO written evals is NOT a failure: it is reported on the `skipped_*`
 * outputs so the job can print a visible "SKIP <name> (no evals)" line instead of going red.
 *
 * Emits GitHub Actions step outputs (skills, agents, run_workflow, skipped_skills, skipped_agents)
 * to $GITHUB_OUTPUT. Pure filesystem + string work — no deps.
 */

import { existsSync, readdirSync, appendFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const EVALS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");

const changed = (process.env.CHANGED_FILES ?? "")
  .split("\n")
  .map((s) => s.trim())
  .filter(Boolean);

/** Does evals/<tier>/<name>/ contain at least one *.eval.ts? */
function hasEvals(tier, name) {
  const dir = join(EVALS_DIR, tier, name);
  if (!existsSync(dir)) return false;
  return readdirSync(dir).some((f) => f.endsWith(".eval.ts"));
}

/** Every artifact name under evals/<tier>/ that has evals. */
function allWithEvals(tier) {
  const dir = join(EVALS_DIR, tier);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((n) => hasEvals(tier, n)).sort();
}

/** Collect distinct artifact names touched under a `.claude` and/or `evals` prefix. */
function touched(reClaude, reEvals) {
  const names = new Set();
  for (const f of changed) {
    const m = f.match(reClaude) ?? f.match(reEvals);
    if (m) names.add(m[1]);
  }
  return [...names].sort();
}

const machineryChanged = changed.some(
  (f) =>
    /^evals\/src\//.test(f) ||
    /^evals\/proxy\//.test(f) ||
    /^evals\/scripts\//.test(f) ||
    /^evals\/(package\.json|pnpm-lock\.yaml|vitest\.config\.ts|tsconfig\.json)$/.test(f) ||
    f === ".github/workflows/harness-evals.yml",
);
const full = process.env.FULL === "1" || machineryChanged;

const skillNames = touched(/^\.claude\/skills\/([^/]+)\//, /^evals\/skills\/([^/]+)\//);
// .claude/agents/README.md is the folder index, not an agent.
const agentNames = touched(/^\.claude\/agents\/([^/]+)\.md$/, /^evals\/agents\/([^/]+)\//).filter(
  (n) => n !== "README",
);

const skills = full ? allWithEvals("skills") : skillNames.filter((n) => hasEvals("skills", n));
const skippedSkills = skillNames.filter((n) => !hasEvals("skills", n));
const agents = full ? allWithEvals("agents") : agentNames.filter((n) => hasEvals("agents", n));
const skippedAgents = agentNames.filter((n) => !hasEvals("agents", n));

// The workflow tier measures the LIVE harness, so anything that changes it re-triggers it:
// every CLAUDE.md (nested ones route package docs), any agent definition, the project settings
// and hooks that Claude Code loads with settingSources:["project"], and the workflow cases.
const runWorkflow =
  full ||
  changed.some(
    (f) =>
      /(^|\/)CLAUDE\.md$/.test(f) ||
      (/^\.claude\/agents\/.+\.md$/.test(f) && f !== ".claude/agents/README.md") ||
      f === ".claude/settings.json" ||
      /^\.claude\/hooks\//.test(f) ||
      /^evals\/workflow\//.test(f),
  );

const out = process.env.GITHUB_OUTPUT;
const write = (k, v) => (out ? appendFileSync(out, `${k}=${v}\n`) : console.log(`${k}=${v}`));

write("skills", JSON.stringify(skills));
write("agents", JSON.stringify(agents));
write("run_workflow", String(runWorkflow));
write("skipped_skills", skippedSkills.join(" "));
write("skipped_agents", skippedAgents.join(" "));

// Human-readable summary in the step log.
console.error("── eval change detection ──");
console.error(`changed files : ${changed.length}`);
console.error(`full run      : ${full ? (machineryChanged ? "yes (eval machinery changed)" : "yes (FULL=1)") : "no"}`);
console.error(`skills → run  : ${skills.join(", ") || "(none)"}`);
console.error(`agents → run  : ${agents.join(", ") || "(none)"}`);
console.error(`workflow tier : ${runWorkflow ? "run" : "skip"}`);
if (skippedSkills.length) console.error(`SKIP skills (no evals): ${skippedSkills.join(", ")}`);
if (skippedAgents.length) console.error(`SKIP agents (no evals): ${skippedAgents.join(", ")}`);
