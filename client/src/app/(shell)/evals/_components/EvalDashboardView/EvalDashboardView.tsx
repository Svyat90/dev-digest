/* /evals — Eval Dashboard (SPEC-05): every agent's latest eval result, the 20
   newest runs of the workspace and "Run all agents". */
"use client";

import { useTranslations } from "next-intl";
import { EmptyState, ErrorState, SectionLabel, Skeleton } from "@devdigest/ui";
import { useCrumb } from "@/components/app-shell";
import { useEvalDashboard } from "@/lib/hooks/eval-dashboard";
import { AgentRows } from "./AgentRows";
import { RecentRunsAll } from "./RecentRunsAll";
import { RunAllAction } from "./RunAllAction";
import { runAllPlan } from "./helpers";
import { s } from "./styles";

export function EvalDashboardView() {
  const t = useTranslations("eval");
  const { data, isLoading, isError, error, refetch } = useEvalDashboard();

  useCrumb([{ label: t("page.crumbSkillsLab") }, { label: t("page.crumbEvalDashboard") }]);

  const plan = runAllPlan(data?.agents ?? []);

  return (
    <div style={s.page}>
      <div style={s.header}>
        <div>
          <h1 style={s.h1}>{t("workspace.title")}</h1>
          <div style={s.subtitle}>{t("workspace.subtitle")}</div>
        </div>
        {data && <RunAllAction plan={plan} />}
      </div>

      {isLoading && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <Skeleton height={52} />
          <Skeleton height={52} />
          <Skeleton height={52} />
        </div>
      )}

      {isError && <ErrorState title={t("workspace.title")} body={error?.message} onRetry={() => refetch()} />}

      {data && data.agents.length === 0 && <EmptyState icon="FlaskConical" title={t("workspace.empty")} />}

      {data && data.agents.length > 0 && (
        <>
          <SectionLabel icon="Cpu">{t("workspace.agentsHeading")}</SectionLabel>
          <AgentRows agents={data.agents} />
          <SectionLabel icon="History">{t("workspace.recentHeading")}</SectionLabel>
          <RecentRunsAll runs={data.recent_runs} />
        </>
      )}
    </div>
  );
}
