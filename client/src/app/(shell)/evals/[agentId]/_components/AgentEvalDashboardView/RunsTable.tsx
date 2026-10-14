import { useFormatter, useTranslations } from "next-intl";
import { Checkbox } from "@devdigest/ui";
import type { AgentEvalRunSummary } from "@devdigest/shared";
import { formatUsd } from "@/lib/format";
import { formatPercent } from "@/lib/eval-metrics";
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
    <th scope="col" style={s.th}>
      {t(`agentDashboard.table.${k}`)}
    </th>
  );

  return (
    <table style={s.table} aria-label={t("dashboard.recentRuns")}>
      <thead>
        <tr>
          <th style={s.th} />
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
              <td style={s.td} colSpan={3}>
                {r.error}
              </td>
            ) : (
              <>
                <td style={s.td}>{formatPercent(r.recall)}</td>
                <td style={s.td}>{formatPercent(r.precision)}</td>
                <td style={s.td}>{formatPercent(r.citation_accuracy)}</td>
              </>
            );
          return (
            <tr key={r.id}>
              <td style={s.td}>
                {r.status === "completed" && (
                  <Checkbox
                    checked={selected.includes(r.id)}
                    onChange={(v) => onToggle(r.id, v)}
                    label={<span style={s.srOnly}>{t("agentDashboard.table.select", { version: r.agent_version })}</span>}
                  />
                )}
              </td>
              <td style={s.td}>
                {format.dateTime(new Date(r.started_at), { dateStyle: "medium", timeStyle: "short" })}
              </td>
              <td style={s.td}>v{r.agent_version}</td>
              {metrics}
              <td style={s.td}>
                {r.status === "running"
                  ? t("agentDashboard.progress", { done: r.cases_done, total: r.cases_total })
                  : `${r.cases_passed} / ${r.cases_total}`}
              </td>
              <td style={s.td}>{formatUsd(r.cost_usd)}</td>
              <td style={s.td}>{r.status === "completed" ? "" : t(`runStatus.${r.status}`)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
