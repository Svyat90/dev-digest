import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { Badge, Icon, Sparkline } from "@devdigest/ui";
import type { EvalWorkspaceAgentRow } from "@devdigest/shared";
import { formatPercent } from "@/lib/eval-metrics";
import { EVAL_METRIC_COLOR, evalUi } from "@/components/eval-ui";
import { agentRowState } from "./helpers";
import { s } from "./styles";

const METRICS = [
  { key: "recall", label: "recall" },
  { key: "precision", label: "precision" },
  { key: "citation_accuracy", label: "citation" },
] as const;

export function AgentRows({ agents }: { agents: EvalWorkspaceAgentRow[] }) {
  const t = useTranslations("eval");
  const format = useFormatter();

  return (
    <ul style={s.list} aria-label={t("workspace.title")}>
      {agents.map((a) => {
        const state = agentRowState(a);
        const latest = a.latest;
        return (
          <li key={a.id}>
            <Link href={`/evals/${a.id}`} style={s.row}>
              <span style={s.tile} aria-hidden>
                <Icon.Cpu size={18} />
              </span>
              <div style={s.rowMain}>
                <div style={s.nameLine}>
                  <span style={s.name}>{a.name}</span>
                  <span style={evalUi.chip}>{a.model}</span>
                  {!a.enabled && <Badge>{t("workspace.disabled")}</Badge>}
                </div>
                <div style={s.sub}>
                  {latest
                    ? t("workspace.lastRun", {
                        version: latest.agent_version,
                        startedAt: format.dateTime(new Date(latest.started_at), {
                          dateStyle: "medium",
                          timeStyle: "short",
                        }),
                        passed: latest.cases_passed,
                        total: latest.cases_total,
                      })
                    : state === "noCases"
                      ? t("workspace.noCases")
                      : t("workspace.neverRun")}
                </div>
              </div>
              {a.recall_trend.length >= 2 && (
                <Sparkline data={a.recall_trend.map((v) => v * 100)} color={EVAL_METRIC_COLOR.recall} w={72} h={28} />
              )}
              <div style={s.metrics}>
                {METRICS.map(({ key, label }) => (
                  <div key={key} style={s.metric}>
                    <span style={s.metricLabel}>{t(`workspace.metricShort.${label}`)}</span>
                    <span style={{ ...s.metricValue, color: EVAL_METRIC_COLOR[key] }}>
                      {formatPercent(latest?.[key])}
                    </span>
                  </div>
                ))}
              </div>
              <Icon.ChevronRight size={16} style={s.chevron} aria-hidden />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
