import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import type { EvalWorkspaceRun } from "@devdigest/shared";
import { formatPercent } from "@/lib/eval-metrics";
import { s } from "./styles";

export function RecentRunsAll({ runs }: { runs: EvalWorkspaceRun[] }) {
  const t = useTranslations("eval");
  const format = useFormatter();

  if (runs.length === 0) return <p style={s.note}>{t("workspace.recentEmpty")}</p>;

  const col = (k: string) => (
    <th scope="col" style={s.th}>
      {t(`workspace.columns.${k}`)}
    </th>
  );

  return (
    <table style={s.table} aria-label={t("dashboard.recentRuns")}>
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
              <td style={s.td}>
                <Link href={`/evals/${r.agent_id}`} style={s.link}>
                  {r.agent_name}
                </Link>
              </td>
              <td style={s.td}>
                {format.dateTime(new Date(r.started_at), { dateStyle: "medium", timeStyle: "short" })}
              </td>
              <td style={s.td}>v{r.agent_version}</td>
              {failed ? (
                <td style={s.td} colSpan={3}>
                  {r.error}
                </td>
              ) : (
                <>
                  <td style={s.td}>{formatPercent(r.recall)}</td>
                  <td style={s.td}>{formatPercent(r.precision)}</td>
                  <td style={s.td}>{formatPercent(r.citation_accuracy)}</td>
                </>
              )}
              <td style={s.td}>
                {r.cases_passed} / {r.cases_total}
              </td>
              <td style={s.td}>{r.status === "completed" ? "" : t(`runStatus.${r.status}`)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
