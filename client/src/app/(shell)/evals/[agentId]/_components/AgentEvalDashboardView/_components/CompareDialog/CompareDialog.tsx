"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Modal, Button, ErrorState, Skeleton } from "@devdigest/ui";
import { useConfirm } from "@/components/confirm-dialog";
import { useToast } from "@/lib/toast";
import { useEvalRunComparison, usePromoteEvalRun } from "@/lib/hooks/eval-dashboard";
import { MetricDeltas } from "./MetricDeltas";
import { ConfigDiff } from "./ConfigDiff";
import { DiffLines } from "./DiffLines";
import { promoteConfirmBody } from "./helpers";
import { s } from "./styles";

const KNOWN_ERRORS = ["eval_promote_noop", "eval_run_not_completed", "not_found"] as const;

/** Compare two completed runs and promote the later run's configuration. */
export function CompareDialog({
  agentId,
  runIds,
  onClose,
}: {
  agentId: string;
  runIds: readonly [string, string];
  onClose: () => void;
}) {
  const t = useTranslations("eval");
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const { data, isLoading, isError, refetch } = useEvalRunComparison(agentId, runIds);
  const promote = usePromoteEvalRun(agentId);
  const hintId = React.useId();

  const code = (promote.error as { code?: string } | null)?.code;
  const errorText = promote.error
    ? t(
        `compare.errors.${(KNOWN_ERRORS as readonly string[]).includes(code ?? "") ? code : "generic"}`,
      )
    : null;

  const title = data
    ? t("compare.title", { from: data.earlier.agent_version, to: data.later.agent_version })
    : t("compare.title", { from: "…", to: "…" });

  const onPromote = () => {
    if (!data) return;
    const { later, promote: preview } = data;
    confirm(
      {
        title: t("compare.promoteConfirmTitle", { version: later.agent_version }),
        body: promoteConfirmBody(preview, (key, values) => t(key, values)),
        confirmLabel: t("compare.promoteConfirm"),
      },
      () =>
        promote.mutate(later.id, {
          onSuccess: (res) => {
            toast.success(
              t("compare.promoted", { run: later.agent_version, version: res.agent_version }),
            );
            onClose();
          },
        }),
    );
  };

  return (
    // Modal is not portaled (client INSIGHTS): keep clicks from reaching the parent.
    <div onClick={(e) => e.stopPropagation()}>
      <Modal width={820} title={title} onClose={onClose}>
        {isLoading && <Skeleton height={220} />}
        {isError && <ErrorState body={t("compare.loadError")} onRetry={() => refetch()} />}
        {data && (
          <>
            <div style={s.body}>
              <MetricDeltas earlier={data.earlier} later={data.later} />
              {data.case_sets.added + data.case_sets.removed > 0 && (
                <div style={s.notice}>
                  {t("alert.caseSetsDiffer", {
                    added: data.case_sets.added,
                    removed: data.case_sets.removed,
                  })}
                </div>
              )}
              <section style={s.section}>
                <h3 style={s.heading}>{t("compare.systemPrompt")}</h3>
                {data.earlier.config.system_prompt === data.later.config.system_prompt ? (
                  <div style={s.muted}>{t("compare.promptUnchanged")}</div>
                ) : (
                  <DiffLines
                    before={data.earlier.config.system_prompt}
                    after={data.later.config.system_prompt}
                  />
                )}
              </section>
              <section style={s.section}>
                <h3 style={s.heading}>{t("compare.configHeading")}</h3>
                <ConfigDiff configChanges={data.config_changes} skillChanges={data.skill_changes} />
              </section>
            </div>
            {errorText && (
              <div role="alert" style={s.error}>
                {errorText}
              </div>
            )}
            <div style={s.footer}>
              {data.promote.is_current && (
                <span id={hintId} style={s.hint}>
                  {t("compare.promoteCurrent")}
                </span>
              )}
              <Button kind="secondary" onClick={onClose}>{t("compare.close")}</Button>
              <Button
                kind="primary"
                onClick={onPromote}
                disabled={data.promote.is_current || promote.isPending}
                aria-describedby={data.promote.is_current ? hintId : undefined}
              >
                {t("compare.promote", { version: data.later.agent_version })}
              </Button>
            </div>
          </>
        )}
      </Modal>
      {dialog}
    </div>
  );
}
