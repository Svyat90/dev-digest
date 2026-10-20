"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Modal, SelectInput } from "@devdigest/ui";
import { useAgents } from "@/lib/hooks/agents";
import { useKeydown } from "@/lib/hooks/useKeydown";

const PICKER_WIDTH = 480;

/** Asks which agent a skill's evals run through (SPEC-06 AC18, AC21). */
export function AgentPickerDialog({
  currentAgentId,
  missingAgentName,
  pending,
  onConfirm,
  onCancel,
}: {
  currentAgentId: string | null;
  missingAgentName: string | null;
  pending: boolean;
  onConfirm: (agentId: string) => void;
  onCancel: () => void;
}) {
  const t = useTranslations("eval");
  const agentsQ = useAgents();
  const agents = agentsQ.data ?? [];
  const [picked, setPicked] = React.useState<string | null>(null);
  // Derived default: the remembered agent while it still exists, else the first one.
  const selected =
    picked ?? (agents.some((a) => a.id === currentAgentId) ? currentAgentId : agents[0]?.id) ?? "";

  useKeydown((e) => {
    if (e.key === "Escape") onCancel();
  });

  return (
    // The kit's Modal is not portaled: keep its clicks away from clickable ancestors.
    <div onClick={(e) => e.stopPropagation()}>
      <Modal
        width={PICKER_WIDTH}
        title={t("skillEvals.picker.title")}
        subtitle={t("skillEvals.picker.body")}
        onClose={onCancel}
        footer={
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <Button kind="ghost" onClick={onCancel}>
              {t("skillEvals.picker.cancel")}
            </Button>
            <Button
              kind="primary"
              disabled={!selected || pending}
              loading={pending}
              onClick={() => onConfirm(selected)}
            >
              {t("skillEvals.picker.confirm")}
            </Button>
          </div>
        }
      >
        <div style={{ padding: "20px 24px", display: "grid", gap: 12 }}>
          {missingAgentName ? (
            <div role="status" style={{ fontSize: 13, color: "var(--warn)" }}>
              {t("skillEvals.picker.missing", { name: missingAgentName })}
            </div>
          ) : null}
          {!agentsQ.isLoading && agents.length === 0 ? (
            <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>{t("skillEvals.picker.noAgents")}</div>
          ) : (
            <label style={{ display: "grid", gap: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-secondary)" }}>
                {t("skillEvals.picker.label")}
              </span>
              <SelectInput
                value={selected}
                mono={false}
                options={agents.map((a) => ({ value: a.id, label: a.name }))}
                onChange={setPicked}
              />
            </label>
          )}
        </div>
      </Modal>
    </div>
  );
}
