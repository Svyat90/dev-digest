import { useFormatter, useTranslations } from "next-intl";
import { Checkbox } from "@devdigest/ui";
import type { AgentEvalRunSummary } from "@devdigest/shared";
import { formatUsd } from "@/lib/format";
import { EVAL_METRIC_COLOR, MetricBar, RunStatus, evalUi } from "@/components/eval-ui";
import { s } from "./styles";

export function RunsTable({
  runs,
  selected,
  onToggle,
}: {
  runs: AgentEvalRunSummary[];
  selected: readonly string[];
  onToggle: (runId: string, checked: boolean) => void;
}) {
  const t = useTranslations("eval");
  const format = useFormatter();

  const col = (k: string) => (
    <th scope="col" style={evalUi.th}>
      {t(`agentDashboard.table.${k}`)}
    </th>
  );

  return (
    <div style={evalUi.panel}>
    <table style={evalUi.table} aria-label={t("dashboard.recentRuns")}>
      <thead>
        <tr>
          <th style={evalUi.th} />
          {col("startedAt")}
          {col("version")}
          {col("recall")}
          {col("precision")}
          {col("citation")}
          {col("passed")}
          {col("cost")}
          {col("status")}
        </tr>
      </thead>
      <tbody>
        {runs.map((r) => {
          const metrics =
            r.status === "failed" ? (
              <td style={evalUi.td} colSpan={3}>
                {r.error}
              </td>
            ) : (
              <>
                <td style={evalUi.td}><MetricBar value={r.recall} color={EVAL_METRIC_COLOR.recall} /></td>
                <td style={evalUi.td}><MetricBar value={r.precision} color={EVAL_METRIC_COLOR.precision} /></td>
                <td style={evalUi.td}><MetricBar value={r.citation_accuracy} color={EVAL_METRIC_COLOR.citation_accuracy} /></td>
              </>
            );
          return (
            <tr key={r.id}>
              <td style={evalUi.td}>
                {r.status === "completed" && (
                  <Checkbox
                    checked={selected.includes(r.id)}
                    onChange={(v) => onToggle(r.id, v)}
                    label={<span style={s.srOnly}>{t("agentDashboard.table.select", { version: r.agent_version })}</span>}
                  />
                )}
              </td>
              <td style={evalUi.td}>
                <span style={evalUi.mono}>
                  {format.dateTime(new Date(r.started_at), { dateStyle: "medium", timeStyle: "short" })}
                </span>
              </td>
              <td style={evalUi.td}>
                <span style={evalUi.version}>v{r.agent_version}</span>
              </td>
              {metrics}
              <td style={{ ...evalUi.td, ...evalUi.strong }}>
                {r.status === "running"
                  ? t("agentDashboard.progress", { done: r.cases_done, total: r.cases_total })
                  : `${r.cases_passed} / ${r.cases_total}`}
              </td>
              <td style={evalUi.td}>{formatUsd(r.cost_usd)}</td>
              <td style={evalUi.td}><RunStatus status={r.status} /></td>
            </tr>
          );
        })}
      </tbody>
    </table>
    </div>
  );
}
