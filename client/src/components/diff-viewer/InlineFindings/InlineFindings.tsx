/* InlineFindings — review findings rendered under the RIGHT-side line they
   anchor to, using the shared FindingCard. Twin of CommentThreadView, minus
   the reply composer (findings are accepted/dismissed, not replied to). */
"use client";

import React from "react";
import type { FindingRecord } from "@devdigest/shared";
import { FindingCard } from "@/components/finding-card";
import { cs } from "../comments";
import type { DiffFindingApi } from "../findings";

export function InlineFindings({
  findings,
  api,
}: {
  findings: FindingRecord[];
  api: DiffFindingApi;
}) {
  if (findings.length === 0) return null;
  return (
    <div style={cs.thread}>
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
