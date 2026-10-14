/* /evals/:agentId — one agent's Eval Dashboard (SPEC-05): header with agent and
   range switchers, regression alert, metric cards, trend chart, run table and
   the Compare dialog. The range lives in ?range=. */
"use client";

import React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, EmptyState, ErrorState, Skeleton } from "@devdigest/ui";
import { useCrumb } from "@/components/app-shell";
import { ApiError } from "@/lib/api";
import { useAgentEvalDashboard } from "@/lib/hooks/eval-dashboard";
import { useSearchParamState } from "@/lib/hooks/useSearchParamState";
import { AlertBanner } from "./_components/AlertBanner";
import { CompareDialog } from "./_components/CompareDialog";
import { MetricCards } from "./_components/MetricCards";
import { TrendChart } from "./_components/TrendChart";
import { DashboardHeader } from "./DashboardHeader";
import { RunsTable } from "./RunsTable";
import { parseRange, rangeDays, selectedPair } from "./helpers";
import { s } from "./styles";

export function AgentEvalDashboardView() {
  const t = useTranslations("eval");
  const { agentId } = useParams<{ agentId: string }>();
  const [rangeParam, setRangeParam] = useSearchParamState("range");
  const range = parseRange(rangeParam);
  const { data, isLoading, isError, error, refetch } = useAgentEvalDashboard(agentId, range);

  const [selected, setSelected] = React.useState<string[]>([]);
  const [comparing, setComparing] = React.useState(false);

  useCrumb([
    { label: t("page.crumbSkillsLab") },
    { label: t("page.crumbEvalDashboard"), href: "/evals" },
    { label: data?.agent.name ?? "" },
  ]);

  if (isError && error instanceof ApiError && error.status === 404) {
    return (
      <div style={s.page}>
        <EmptyState
          icon="FlaskConical"
          title={t("agentDashboard.notFoundTitle")}
          body={
            <>
              {t("agentDashboard.notFoundBody")}
              <div style={{ marginTop: 12 }}>
                <Link href="/evals">{t("agentDashboard.backToDashboard")}</Link>
              </div>
            </>
          }
        />
      </div>
    );
  }

  if (isError) {
    return (
      <div style={s.page}>
        <ErrorState title={t("workspace.title")} body={error?.message} onRetry={() => refetch()} />
      </div>
    );
  }

  if (isLoading || !data) {
    return (
      <div style={s.page}>
        <Skeleton height={52} />
        <Skeleton height={120} />
      </div>
    );
  }

  const pair = selectedPair(selected, data.runs);
  const days = rangeDays(range);

  const toggle = (runId: string, checked: boolean) =>
    setSelected((cur) => (checked ? [...cur.filter((x) => x !== runId), runId] : cur.filter((x) => x !== runId)));

  return (
    <div style={s.page}>
      <Link href="/evals" style={s.back}>
        ← {t("agentDashboard.allAgents")}
      </Link>

      <DashboardHeader data={data} agentId={agentId} range={range} onRange={setRangeParam} />

      {data.alert && <AlertBanner alert={data.alert} />}

      <MetricCards latest={data.latest} previous={data.previous} trend={data.trend} />

      {data.trend.length > 0 ? (
        <TrendChart points={data.trend} truncated={data.trend_truncated} />
      ) : (
        <div style={s.empty}>
          <span>
            {days == null
              ? t("agentDashboard.emptyAll")
              : t("agentDashboard.emptyRange", { days })}
          </span>
          {days != null && (
            <Button kind="secondary" size="sm" onClick={() => setRangeParam("all")}>
              {t("agentDashboard.showAll")}
            </Button>
          )}
        </div>
      )}

      {data.runs.length > 0 && (
        <>
          <div style={s.tableBar}>
            <Button
              kind="secondary"
              size="sm"
              disabled={!pair}
              onClick={() => setComparing(true)}
              aria-describedby="eval-compare-hint"
            >
              {t("agentDashboard.compare")}
            </Button>
            {!pair && (
              <span id="eval-compare-hint" style={s.note}>
                {t("agentDashboard.compareHint")}
              </span>
            )}
          </div>
          <RunsTable runs={data.runs} selected={selected} onToggle={toggle} />
        </>
      )}

      {comparing && pair && (
        <CompareDialog agentId={agentId} runIds={pair} onClose={() => setComparing(false)} />
      )}
    </div>
  );
}
