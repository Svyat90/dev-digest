import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { EvalRegressionAlert } from "@devdigest/shared";
import { othersSentenceKey } from "./helpers";
import { s } from "./styles";

/** Deterministic regression banner: the dropped metric, the cause and how the others moved (AC15, AC19). */
export function AlertBanner({ alert }: { alert: EvalRegressionAlert }) {
  const t = useTranslations("eval");
  const key = othersSentenceKey(alert.others);
  const [first, second] = alert.others;
  const dir = (d: "up" | "down" | "same") => t(`alert.direction.${d}`);

  let others: string | null = null;
  if (key && first) {
    const a = t(`alert.metricName.${first.metric}`);
    if (key === "otherOne") others = t("alert.otherOne", { a, direction: dir(first.direction) });
    else if (second) {
      const b = t(`alert.metricNameLower.${second.metric}`);
      others =
        key === "othersBoth"
          ? t("alert.othersBoth", { a, b, direction: dir(first.direction) })
          : t("alert.othersEach", { a, b, directionA: dir(first.direction), directionB: dir(second.direction) });
    }
  }

  return (
    <div role="alert" style={s.banner}>
      <Icon.AlertTriangle size={16} style={s.icon} aria-hidden />
      <p style={s.text}>
        {t("alert.dropped", {
          metric: t(`alert.metricName.${alert.metric}`),
          points: alert.drop_points,
          version: alert.agent_version,
          cause: t(`alert.cause.${alert.metric}`),
        })}
        {others ? ` ${others}` : null}
        {alert.case_sets.added + alert.case_sets.removed > 0 ? (
          <span style={s.notice}>
            {t("alert.caseSetsDiffer", { added: alert.case_sets.added, removed: alert.case_sets.removed })}
          </span>
        ) : null}
      </p>
    </div>
  );
}
