import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { Badge, Sparkline } from "@devdigest/ui";
import type { EvalWorkspaceAgentRow } from "@devdigest/shared";
import { formatPercent } from "@/lib/eval-metrics";
import { agentRowState } from "./helpers";
import { s } from "./styles";

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
              <div style={s.rowMain}>
                <div style={s.name}>
                  {a.name}{" "}
                  {!a.enabled && <Badge>{t("workspace.disabled")}</Badge>}
                </div>
                <div style={s.sub}>
                  {a.model} ·{" "}
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
                <Sparkline data={a.recall_trend.map((v) => v * 100)} />
              )}
              <div style={s.metrics}>
                <span>{formatPercent(latest?.recall)}</span>
                <span>{formatPercent(latest?.precision)}</span>
                <span>{formatPercent(latest?.citation_accuracy)}</span>
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
