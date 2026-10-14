"use client";

import { useEffect, useId, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button, SectionLabel } from "@devdigest/ui";
import type { EvalCaseListItem } from "@devdigest/shared";
import {
  useAgentEvalCases,
  useAgentEvalRuns,
  useDeleteEvalCase,
  useStartEvalRun,
} from "@/lib/hooks/evals";
import { useStartEvalCaseCheck } from "@/lib/hooks/eval-cases";
import { useAgent } from "@/lib/hooks/agents";
import { useConfirm } from "@/components/confirm-dialog/useConfirm";
import {
  CaseList,
  MetricCards,
  RunHistory,
  latestCompleted,
  previousCompleted,
  progressOf,
  rateLimitedUntil,
  runAllBlocker,
} from "@/components/eval-suite";
import { CaseEditor } from "@/components/case-editor";
import { s } from "./styles";

/** Agent editor "Evals" tab: metrics, eval cases (new / edit / run / delete), Run all evals, run history. */
export function EvalsTab({ agentId }: { agentId: string }) {
  const t = useTranslations("eval");
  const reasonId = useId();
  const owner = { kind: "agent", id: agentId } as const;
  const agentQ = useAgent(agentId);
  const runsQ = useAgentEvalRuns(agentId);
  const runs = runsQ.data ?? [];
  const running = runs.find((r) => r.status === "running") ?? null;
  const [editor, setEditor] = useState<{ caseId: string | null; trigger: HTMLElement | null } | null>(null);
  const [limitedUntil, setLimitedUntil] = useState<number | null>(null);
  // Per-case results appear once the run (A14) or a single-case run closes, so refetch while either runs.
  // Whether a check runs is known only from the list itself, so it is carried to the next render.
  const [checkRunning, setCheckRunning] = useState(false);
  const casesQ = useAgentEvalCases(agentId, { refetchIntervalMs: running || checkRunning ? 2000 : false });
  const cases = casesQ.data ?? [];
  const anyCheckRunning = cases.some((c) => c.check?.status === "running");
  if (anyCheckRunning !== checkRunning) setCheckRunning(anyCheckRunning);
  const start = useStartEvalRun(agentId);
  const startCheck = useStartEvalCaseCheck(owner);
  const del = useDeleteEvalCase(agentId);
  const { confirm, dialog } = useConfirm();

  useEffect(() => {
    if (limitedUntil === null) return;
    const timer = setTimeout(() => setLimitedUntil(null), Math.max(0, limitedUntil - Date.now()));
    return () => clearTimeout(timer);
  }, [limitedUntil]);

  const blocker = runAllBlocker(cases, runs);
  const progress = running ? progressOf(running) : null;

  const runDisabledReason = (item: EvalCaseListItem): string | null => {
    if (item.check?.status === "running" || (startCheck.isPending && startCheck.variables === item.id)) {
      return t("caseEditor.runBlocked.running");
    }
    return limitedUntil !== null ? t("caseEditor.runBlocked.rateLimited") : null;
  };

  const runCase = (item: EvalCaseListItem) =>
    startCheck.mutate(item.id, {
      onError: (err) => {
        const until = rateLimitedUntil(err, Date.now());
        if (until !== null) setLimitedUntil(until);
      },
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
      <section style={s.section}>
        <SectionLabel
          icon="Gauge"
          right={
            <Link href={`/evals/${agentId}`} style={{ ...s.meta, textDecoration: "none" }}>
              {t("evalsTab.viewDashboard")}
            </Link>
          }
        >
          {t("evalsTab.metricsTitle")}
        </SectionLabel>
        <MetricCards latest={latestCompleted(runs)} previous={previousCompleted(runs)} />
      </section>

      <section style={s.section}>
        <div style={s.header}>
          <h2 style={s.h2}>{t("evalsTab.casesHeading")}</h2>
          {cases.length > 0 && (
            <span style={s.pill}>
              {t("evalsTab.passingPill", {
                passed: cases.filter((c) => c.latest_result?.status === "passed").length,
                total: cases.length,
              })}
            </span>
          )}
          <span style={{ ...s.meta, ...s.spacer }} aria-live="polite">
            {progress ? t("evalsTab.progress", progress) : ""}
          </span>
          <Button
            kind="secondary"
            size="sm"
            icon="Play"
            disabled={blocker !== null || start.isPending}
            loading={start.isPending}
            aria-describedby={blocker ? reasonId : undefined}
            onClick={() => start.mutate()}
          >
            {t("evalsTab.runAll")}
          </Button>
          <Button
            kind="secondary"
            size="sm"
            icon="Plus"
            onClick={(event) => setEditor({ caseId: null, trigger: event.currentTarget })}
          >
            {t("caseEditor.newCase")}
          </Button>
        </div>
        {blocker ? (
          <div id={reasonId} style={s.meta}>
            {t(`evalsTab.blocker.${blocker}`)}
          </div>
        ) : null}
        {casesQ.isLoading ? (
          <div style={s.message}>{t("evalsTab.loadingCases")}</div>
        ) : cases.length === 0 ? (
          <div style={s.message}>{t("evalsTab.emptyCases")}</div>
        ) : (
          <CaseList
            cases={cases}
            onDelete={askDelete}
            onEdit={(item, trigger) => setEditor({ caseId: item.id, trigger })}
            onRun={runCase}
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
          <RunHistory runs={runs} />
        )}
      </section>
      {dialog}
      {editor ? (
        <CaseEditor
          owner={owner}
          ownerName={agentQ.data?.name ?? ""}
          caseId={editor.caseId}
          otherNames={cases.filter((c) => c.id !== editor.caseId).map((c) => c.name)}
          runBlocker={null}
          viaAgentName={null}
          returnFocusTo={editor.trigger}
          onClose={() => setEditor(null)}
        />
      ) : null}
    </div>
  );
}
