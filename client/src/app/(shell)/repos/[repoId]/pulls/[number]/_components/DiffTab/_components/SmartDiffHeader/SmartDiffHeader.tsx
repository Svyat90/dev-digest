/* SmartDiffHeader — presentational header for the Files changed tab: the
   "Reviewer-ordered diff" label + stats, the Smart/Original segmented order
   toggle, and the one show/hide button for GitHub comments + review findings.
   No data fetching, no derived state — everything comes from DiffTab. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Icon } from "@devdigest/ui";
import { s, segmentButton } from "../../styles";

export type DiffOrder = "smart" | "original";

interface DiffTotals {
  files: number;
  additions: number;
  deletions: number;
}

export function SmartDiffHeader({
  totals,
  order,
  onOrderChange,
  showComments,
  onToggleComments,
  commentCount,
  openFindingCount,
}: {
  totals: DiffTotals;
  order: DiffOrder;
  onOrderChange: (order: DiffOrder) => void;
  showComments: boolean;
  onToggleComments: () => void;
  commentCount: number;
  openFindingCount: number;
}) {
  const t = useTranslations("prReview");
  const showCommentsToggle = commentCount + openFindingCount > 0;

  return (
    <div style={s.header}>
      <div style={s.headerRow}>
        <Icon.Code size={14} style={s.headerIcon} />
        <span style={s.headerLabel}>{t("smartDiff.headerLabel")}</span>
        <span style={s.headerStats}>
          {t("smartDiff.headerStats", {
            files: totals.files,
            additions: totals.additions,
            deletions: totals.deletions,
          })}
        </span>
        <span style={s.headerSpacer} />
        <div role="group" aria-label={t("smartDiff.orderToggleLabel")} style={s.segmented}>
          <button
            type="button"
            aria-pressed={order === "smart"}
            onClick={() => onOrderChange("smart")}
            style={segmentButton(order === "smart")}
          >
            {t("smartDiff.orderSmart")}
          </button>
          <button
            type="button"
            aria-pressed={order === "original"}
            onClick={() => onOrderChange("original")}
            style={segmentButton(order === "original")}
          >
            {t("smartDiff.orderOriginal")}
          </button>
        </div>
        {showCommentsToggle && (
          <Button kind="ghost" size="sm" icon={showComments ? "EyeOff" : "Eye"} onClick={onToggleComments}>
            {showComments ? t("smartDiff.hideFindingsAndComments") : t("smartDiff.showFindingsAndComments")}
          </Button>
        )}
      </div>
    </div>
  );
}
