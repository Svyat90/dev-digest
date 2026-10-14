import React from "react";
import { useTranslations } from "next-intl";
import { Button } from "@devdigest/ui";
import type { RunAllEvalsResponse } from "@devdigest/shared";
import { ApiError } from "@/lib/api";
import { useConfirm } from "@/components/confirm-dialog/useConfirm";
import { useRunAllEvals } from "@/lib/hooks/eval-dashboard";
import type { RunAllPlan } from "./helpers";
import { s } from "./styles";

export function RunAllAction({ plan }: { plan: RunAllPlan }) {
  const t = useTranslations("eval");
  const { confirm, dialog } = useConfirm();
  const runAll = useRunAllEvals();
  const [result, setResult] = React.useState<RunAllEvalsResponse | null>(null);

  const start = () => {
    setResult(null);
    runAll.mutate(undefined, { onSuccess: (r) => setResult(r) });
  };

  const onClick = () => {
    const lines = [
      t("workspace.runAllConfirmBody", { agents: plan.runnable, cases: plan.totalCases }),
      ...plan.skipped.map((k) =>
        t("workspace.runAllSkipped", { name: k.name, reason: t(`workspace.skipReason.${k.reason}`) }),
      ),
    ];
    confirm(
      {
        title: t("workspace.runAllConfirmTitle"),
        body: lines.join("\n"),
        confirmLabel: t("workspace.runAllConfirm"),
      },
      start,
    );
  };

  const err = runAll.error;
  const errText =
    err instanceof ApiError && err.code === "run_start_rate_limited"
      ? t("workspace.rateLimited")
      : err?.message;

  return (
    <div style={s.spacer}>
      <Button kind="primary" onClick={onClick} disabled={!!plan.blocker || runAll.isPending}>
        {t("workspace.runAll")}
      </Button>
      {plan.blocker && <span style={s.note}>{t(`workspace.runAllBlocked.${plan.blocker}`)}</span>}
      {result && (
        <span role="status" style={s.note}>
          {t("workspace.runAllStarted", { count: result.started.length })}
        </span>
      )}
      {runAll.isError && errText && (
        <span role="alert" style={s.error}>
          {errText}
        </span>
      )}
      {dialog}
    </div>
  );
}
