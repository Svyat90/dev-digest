/* OffPatchFindings — footer list for findings whose anchored line is not in
   the current patch (e.g. a stale diff). Mirrors OutdatedComments. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { FindingRecord } from "@devdigest/shared";
import { FindingCard } from "@/components/finding-card";
import { cs } from "../comments";
import type { DiffFindingApi } from "../findings";

export function OffPatchFindings({
  findings,
  api,
}: {
  findings: FindingRecord[];
  api: DiffFindingApi;
}) {
  const t = useTranslations("prReview");
  if (findings.length === 0) return null;
  return (
    <div style={cs.outdatedWrap}>
      <span style={cs.outdatedTitle}>
        {t("smartDiff.offPatchTitle", { count: findings.length })}
      </span>
      {findings.map((f) => (
        <FindingCard
          key={f.id}
          f={f}
          defaultExpanded
          onAction={(action) => api.onAction(f, action)}
          pending={api.pending}
          repoFullName={api.repoFullName}
          headSha={api.headSha}
        />
      ))}
    </div>
  );
}
