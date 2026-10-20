import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Button, SelectInput } from "@devdigest/ui";
import type { EvalDashboard, EvalDashboardRange } from "@devdigest/shared";
import { ApiError } from "@/lib/api";
import { useAgents } from "@/lib/hooks/agents";
import { useStartEvalRun } from "@/lib/hooks/evals";
import { evalUi } from "@/components/eval-ui";
import { RANGES, parseRange, runEvalBlocker } from "./helpers";
import { s } from "./styles";

export function DashboardHeader({
  data,
  agentId,
  range,
  onRange,
}: {
  data: EvalDashboard;
  agentId: string;
  range: EvalDashboardRange;
  onRange: (range: EvalDashboardRange) => void;
}) {
  const t = useTranslations("eval");
  const router = useRouter();
  const { data: agents } = useAgents();
  const start = useStartEvalRun(agentId);

  const blocker = runEvalBlocker(data.cases_total, data.running_run);
  const run = data.running_run;

  const err = start.error;
  const errText =
    err instanceof ApiError && err.code === "run_start_rate_limited"
      ? t("workspace.rateLimited")
      : err?.message;

  const agentOptions = (agents ?? []).map((a) => ({ value: a.id, label: a.name }));
  if (!agentOptions.some((o) => o.value === agentId)) {
    agentOptions.push({ value: agentId, label: data.agent.name });
  }

  return (
    <div style={s.header}>
      <div>
        <div style={s.titleLine}>
          <h1 style={s.h1}>{data.agent.name}</h1>
          <span style={evalUi.chip}>{data.agent.model}</span>
        </div>
        <div style={s.model}>
          {t("dashboard.casesSummary", { count: data.cases_total, runs: data.runs.length })}
        </div>
      </div>
      <div style={s.controls}>
        <label style={s.field}>
          <span style={s.srOnly}>{t("agentDashboard.switcherLabel")}</span>
          <SelectInput
            value={agentId}
            options={agentOptions}
            mono={false}
            onChange={(id) => router.push(`/evals/${id}?range=${range}`)}
          />
        </label>
        <label style={s.field}>
          <span style={s.srOnly}>{t("agentDashboard.rangeLabel")}</span>
          <SelectInput
            value={range}
            mono={false}
            options={RANGES.map((r) => ({ value: r, label: t(`agentDashboard.range.${r}`) }))}
            onChange={(v) => onRange(parseRange(v))}
          />
        </label>
        <div style={s.runBox}>
          <Button
            kind="primary"
            icon="Play"
            onClick={() => start.mutate()}
            disabled={!!blocker || start.isPending}
          >
            {t("agentDashboard.runEval")}
          </Button>
          {blocker && <span style={s.note}>{t(`agentDashboard.runBlocked.${blocker}`)}</span>}
          <span aria-live="polite" style={s.note}>
            {run ? t("agentDashboard.progress", { done: run.cases_done, total: run.cases_total }) : ""}
          </span>
          {start.isError && errText && (
            <span role="alert" style={s.error}>
              {errText}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
