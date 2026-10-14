"use client";

import { useId } from "react";
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
import { useConfirm } from "@/components/confirm-dialog/useConfirm";
import {
  CaseList,
  MetricCards,
  RunHistory,
  latestCompleted,
  previousCompleted,
  progressOf,
  runAllBlocker,
} from "@/components/eval-suite";
import { s } from "./styles";

/** Agent editor "Evals" tab: metrics, eval cases, Run all evals, run history. */
export function EvalsTab({ agentId }: { agentId: string }) {
  const t = useTranslations("eval");
  const reasonId = useId();
  const runsQ = useAgentEvalRuns(agentId);
  const runs = runsQ.data ?? [];
  const running = runs.find((r) => r.status === "running") ?? null;
  // Per-case results appear once the run closes, so refetch while one runs (A14).
  const casesQ = useAgentEvalCases(agentId, { refetchIntervalMs: running ? 2000 : false });
  const cases = casesQ.data ?? [];
  const start = useStartEvalRun(agentId);
  const del = useDeleteEvalCase(agentId);
  const { confirm, dialog } = useConfirm();

  const blocker = runAllBlocker(cases, runs);
  const progress = running ? progressOf(running) : null;

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
          <CaseList cases={cases} onDelete={askDelete} />
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
    </div>
  );
}
