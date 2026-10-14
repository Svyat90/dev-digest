import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import type { EvalWorkspaceRun } from "@devdigest/shared";
import { EVAL_METRIC_COLOR, MetricBar, RunStatus, evalUi } from "@/components/eval-ui";
import { s } from "./styles";

export function RecentRunsAll({ runs }: { runs: EvalWorkspaceRun[] }) {
  const t = useTranslations("eval");
  const format = useFormatter();

  if (runs.length === 0) return <p style={s.note}>{t("workspace.recentEmpty")}</p>;

  const col = (k: string) => (
    <th scope="col" style={evalUi.th}>
      {t(`workspace.columns.${k}`)}
    </th>
  );

  return (
    <div style={evalUi.panel}>
    <table style={evalUi.table} aria-label={t("dashboard.recentRuns")}>
      <thead>
        <tr>
          {col("agent")}
          {col("startedAt")}
          {col("version")}
          {col("recall")}
          {col("precision")}
          {col("citation")}
          {col("passed")}
          {col("status")}
        </tr>
      </thead>
      <tbody>
        {runs.map((r) => {
          const failed = r.status === "failed";
          return (
            <tr key={r.id}>
              <td style={evalUi.td}>
                <Link href={`/evals/${r.agent_id}`} style={s.link}>
                  {r.agent_name}
                </Link>
              </td>
              <td style={evalUi.td}>
                <span style={evalUi.mono}>
                  {format.dateTime(new Date(r.started_at), { dateStyle: "medium", timeStyle: "short" })}
                </span>
              </td>
              <td style={evalUi.td}>
                <span style={evalUi.version}>v{r.agent_version}</span>
              </td>
              {failed ? (
                <td style={evalUi.td} colSpan={3}>
                  {r.error}
                </td>
              ) : (
                <>
                  <td style={evalUi.td}>
                    <MetricBar value={r.recall} color={EVAL_METRIC_COLOR.recall} />
                  </td>
                  <td style={evalUi.td}>
                    <MetricBar value={r.precision} color={EVAL_METRIC_COLOR.precision} />
                  </td>
                  <td style={evalUi.td}>
                    <MetricBar value={r.citation_accuracy} color={EVAL_METRIC_COLOR.citation_accuracy} />
                  </td>
                </>
              )}
              <td style={{ ...evalUi.td, ...evalUi.strong }}>
                {r.cases_passed} / {r.cases_total}
              </td>
              <td style={evalUi.td}><RunStatus status={r.status} /></td>
            </tr>
          );
        })}
      </tbody>
    </table>
    </div>
  );
}
