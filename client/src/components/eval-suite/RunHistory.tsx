import { useTranslations } from "next-intl";
import { formatUsd } from "@/lib/format";
import { EVAL_METRIC_COLOR, MetricBar, evalUi } from "@/components/eval-ui";
import { formatStarted, type EvalSuiteRunLike } from "./helpers";

/**
 * Eval runs of one set, newest first. `viaLabel` replaces the version cell
 * (the skill tab: "via <agent> v<n> · skill v<m>").
 */
export function RunHistory<R extends EvalSuiteRunLike>({
  runs,
  viaLabel,
}: {
  runs: readonly R[];
  viaLabel?: (run: R) => string;
}) {
  const t = useTranslations("eval");
  return (
    <div style={evalUi.panel}>
    <table style={evalUi.table} aria-label={t("evalsTab.history.title")}>
      <thead>
        <tr>
          <th style={evalUi.th}>{t("evalsTab.history.started")}</th>
          <th style={evalUi.th}>{t("evalsTab.history.version")}</th>
          <th style={evalUi.th}>{t("dashboard.table.recall")}</th>
          <th style={evalUi.th}>{t("dashboard.table.precision")}</th>
          <th style={evalUi.th}>{t("dashboard.table.citation")}</th>
          <th style={evalUi.th}>{t("evalsTab.history.passed")}</th>
          <th style={evalUi.th}>{t("evalsTab.history.cost")}</th>
          <th style={evalUi.th}>{t("evalsTab.history.status")}</th>
        </tr>
      </thead>
      <tbody>
        {runs.map((r) => (
          <tr key={r.id}>
            <td style={evalUi.td}>
              <span style={evalUi.mono}>{formatStarted(r.started_at)}</span>
            </td>
            <td style={evalUi.td}>
              <span style={evalUi.version}>{viaLabel ? viaLabel(r) : `v${r.agent_version}`}</span>
            </td>
            <td style={evalUi.td}><MetricBar value={r.recall} color={EVAL_METRIC_COLOR.recall} /></td>
            <td style={evalUi.td}><MetricBar value={r.precision} color={EVAL_METRIC_COLOR.precision} /></td>
            <td style={evalUi.td}><MetricBar value={r.citation_accuracy} color={EVAL_METRIC_COLOR.citation_accuracy} /></td>
            <td style={{ ...evalUi.td, ...evalUi.strong }}>{`${r.cases_passed} / ${r.cases_total}`}</td>
            <td style={evalUi.td}>{formatUsd(r.cost_usd)}</td>
            <td style={evalUi.td}>{t(`evalsTab.history.statusValue.${r.status}`)}</td>
          </tr>
        ))}
      </tbody>
    </table>
    </div>
  );
}
