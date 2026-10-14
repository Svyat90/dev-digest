"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, SectionLabel } from "@devdigest/ui";
import type { EvalCaseListItem, Skill, SkillEvalRunSummary } from "@devdigest/shared";
import {
  useDeleteSkillEvalCase,
  useSkillEvalAgent,
  useSkillEvalCases,
  useSkillEvalRuns,
  useStartEvalCaseCheck,
} from "@/lib/hooks/eval-cases";
import { useConfirm } from "@/components/confirm-dialog/useConfirm";
import { CaseEditor } from "@/components/case-editor";
import {
  CaseList,
  MetricCards,
  RunHistory,
  latestCompleted,
  previousCompleted,
  rateLimitedUntil,
} from "@/components/eval-suite";
import { RunSkillEvalsAction } from "./RunSkillEvalsAction";
import { needsAgent } from "./helpers";
import { s } from "./styles";

const POLL_MS = 2000;

/** Which case the editor is open on (`null` id = a new case) and what to refocus on close. */
type EditorTarget = { caseId: string | null; trigger: HTMLElement | null };

/**
 * Skill detail "Evals" tab: metrics of the skill's own runs, its eval cases,
 * Run all evals through the remembered agent, and run history with the via
 * agent and both versions (SPEC-06 AC1, AC17, AC22).
 */
export function SkillEvalsTab({ skill }: { skill: Skill }) {
  const t = useTranslations("eval");
  const owner = { kind: "skill" as const, id: skill.id };
  const runsQ = useSkillEvalRuns(skill.id);
  const runs = runsQ.data ?? [];
  const casesQ = useSkillEvalCases(skill.id);
  const cases = casesQ.data ?? [];
  // A second observer of the same query only adds the 2 s poll while a check or a skill run runs.
  const polling = runs.some((r) => r.status === "running") || cases.some((c) => c.check?.status === "running");
  useSkillEvalCases(skill.id, { refetchIntervalMs: polling ? POLL_MS : false });
  const agentQ = useSkillEvalAgent(skill.id);
  const check = useStartEvalCaseCheck(owner);
  const del = useDeleteSkillEvalCase(skill.id);
  const { confirm, dialog } = useConfirm();
  const [editor, setEditor] = React.useState<EditorTarget | null>(null);

  const latest = latestCompleted(runs);
  const previous = previousCompleted(runs);
  const noAgent = needsAgent(agentQ.data);
  const until = rateLimitedUntil(check.error, check.submittedAt);
  const rateLimited = until !== null && Date.now() < until;

  // Re-enable row runs once the refused start's retry window has passed (A8).
  const resetCheck = check.reset;
  React.useEffect(() => {
    if (until === null) return;
    const id = setTimeout(resetCheck, Math.max(0, until - Date.now()));
    return () => clearTimeout(id);
  }, [until, resetCheck]);

  const runDisabledReason = (item: EvalCaseListItem): string | null => {
    if (noAgent) return t("caseEditor.runBlocked.noAgent");
    if (item.check?.status === "running") return t("caseEditor.runBlocked.running");
    if (rateLimited) return t("caseEditor.runBlocked.rateLimited");
    return null;
  };

  const viaLabel = (run: SkillEvalRunSummary) =>
    t("skillEvals.historyVia", {
      agent: run.agent_deleted ? t("skillEvals.agentDeleted", { name: run.agent_name }) : run.agent_name,
      agentVersion: run.agent_version,
      skillVersion: run.skill_version,
    });

  const askDelete = (item: EvalCaseListItem) =>
    confirm(
      {
        title: t("evalsTab.deleteConfirm.title"),
        body: t("evalsTab.deleteConfirm.body", { name: item.name }),
        confirmLabel: t("evalsTab.deleteConfirm.confirm"),
      },
      () => del.mutate(item.id),
    );

  return (
    <div>
      {latest ? (
        <section style={s.section}>
          <SectionLabel icon="Gauge">{t("evalsTab.metricsTitle")}</SectionLabel>
          <div style={{ ...s.meta, marginBottom: 10 }}>{t("skillEvals.metricsSubtitle")}</div>
          <MetricCards latest={latest} previous={previous} />
        </section>
      ) : null}

      <section style={s.section}>
        <div style={s.header}>
          <h2 style={s.h2}>{t("skillEvals.casesHeading")}</h2>
          {latest ? (
            <span style={s.pill}>
              {t("skillEvals.passing", { passed: latest.cases_passed, total: latest.cases_total })}
            </span>
          ) : null}
          <div style={{ ...s.spacer, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <RunSkillEvalsAction skillId={skill.id} label="runAll" />
            <Button
              kind="secondary"
              size="sm"
              icon="Plus"
              onClick={(event: React.MouseEvent<HTMLButtonElement>) =>
                setEditor({ caseId: null, trigger: event.currentTarget })
              }
            >
              {t("caseEditor.newCase")}
            </Button>
          </div>
        </div>
        {casesQ.isLoading ? (
          <div style={s.message}>{t("evalsTab.loadingCases")}</div>
        ) : cases.length === 0 ? (
          <div style={s.message}>{t("skillEvals.emptyCases")}</div>
        ) : (
          <CaseList
            cases={cases}
            onDelete={askDelete}
            onEdit={(item, trigger) => setEditor({ caseId: item.id, trigger })}
            onRun={(item) => check.mutate(item.id)}
            runDisabledReason={runDisabledReason}
          />
        )}
      </section>

      <section style={s.section}>
        <div style={s.header}>
          <h2 style={s.h2}>{t("evalsTab.history.title")}</h2>
        </div>
        {runs.length === 0 ? (
          <div style={s.message}>{t("evalsTab.history.empty")}</div>
        ) : (
          <RunHistory runs={runs} viaLabel={viaLabel} />
        )}
      </section>

      {editor ? (
        <CaseEditor
          owner={owner}
          ownerName={skill.name}
          caseId={editor.caseId}
          otherNames={cases.filter((c) => c.id !== editor.caseId).map((c) => c.name)}
          runBlocker={noAgent ? "noAgent" : null}
          viaAgentName={agentQ.data?.agent?.name ?? null}
          returnFocusTo={editor.trigger}
          onClose={() => setEditor(null)}
        />
      ) : null}
      {dialog}
    </div>
  );
}
