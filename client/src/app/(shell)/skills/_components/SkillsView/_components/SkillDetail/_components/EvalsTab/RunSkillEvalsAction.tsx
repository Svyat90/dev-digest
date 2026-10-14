"use client";

import { useId } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@devdigest/ui";
import { useSkillEvalRun } from "./useSkillEvalRun";

/** Refusal codes with their own `skillEvals.errors.*` text; anything else reads as generic. */
const KNOWN_ERRORS = new Set([
  "eval_agent_required",
  "eval_agent_missing",
  "no_eval_cases",
  "eval_run_in_progress",
  "run_start_rate_limited",
]);

const meta = { fontSize: 12.5, color: "var(--text-muted)" } as const;

/**
 * "Run all evals" (Evals tab) or "Run on evals" (skill header): runs the
 * skill's cases through its remembered agent, shows "via <agent>" with
 * Change agent, and names why a run cannot start (SPEC-06 AC18, AC21).
 */
export function RunSkillEvalsAction({ skillId, label }: { skillId: string; label: "runAll" | "runOnEvals" }) {
  const t = useTranslations("eval");
  const tSkills = useTranslations("skills");
  const reasonId = useId();
  const c = useSkillEvalRun(skillId);

  const disabled = c.blocker !== null || c.pending || c.rateLimited;
  const errorKey = c.errorCode && KNOWN_ERRORS.has(c.errorCode) ? c.errorCode : "generic";

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      <Button
        kind="secondary"
        size="sm"
        icon="Play"
        disabled={disabled}
        loading={c.pending}
        aria-describedby={c.blocker ? reasonId : undefined}
        onClick={c.run}
      >
        {label === "runAll" ? t("skillEvals.runAll") : tSkills("detail.runOnEvals")}
      </Button>
      {c.agent ? (
        <>
          <span style={meta}>{t("skillEvals.via", { name: c.agent.name })}</span>
          <Button kind="ghost" size="sm" disabled={c.pending} onClick={c.changeAgent}>
            {t("skillEvals.changeAgent")}
          </Button>
        </>
      ) : null}
      {c.blocker ? (
        <span id={reasonId} style={meta}>
          {t(`skillEvals.blocked.${c.blocker}`)}
        </span>
      ) : null}
      {c.errorCode ? (
        <span role="alert" style={{ ...meta, color: "var(--crit)" }}>
          {t(`skillEvals.errors.${errorKey}`)}
        </span>
      ) : null}
      {c.picker}
    </div>
  );
}
