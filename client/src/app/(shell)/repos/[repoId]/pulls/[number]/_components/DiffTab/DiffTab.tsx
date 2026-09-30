"use client";

import React from "react";
import { DiffViewer, type DiffCommentApi, type DiffFindingApi } from "@/components/diff-viewer";
import { usePrComments, useCreatePrComment, usePrReviews, useFindingAction } from "@/lib/hooks/reviews";
import { useSmartDiff } from "@/lib/hooks/smart-diff";
import { notify } from "@/lib/toast";
import type { PrFile } from "@devdigest/shared";
import { buildRoleGroups, diffTotals, findingsByPath, hasAnyReview, latestFindings } from "./helpers";
import { SmartDiffHeader, type DiffOrder } from "./_components/SmartDiffHeader";
import { RoleGroup } from "./_components/RoleGroup";
import { s } from "./styles";

interface DiffTabProps {
  prId: string | null;
  files: PrFile[];
  /** Inline commenting is offered only on open PRs (GitHub rejects otherwise). */
  canComment?: boolean;
  /** For finding cards' "open on GitHub" link. */
  repoFullName?: string | null;
  headSha?: string | null;
}

export function DiffTab({ prId, files, canComment, repoFullName, headSha }: DiffTabProps) {
  const { data: comments } = usePrComments(prId);
  const create = useCreatePrComment(prId);
  const { data: smartDiff } = useSmartDiff(prId);
  const { data: reviews } = usePrReviews(prId);
  const action = useFindingAction();

  const [order, setOrder] = React.useState<DiffOrder>("smart");
  // `null` means "no explicit choice yet" — the effective value defaults to
  // shown once the PR has open findings, hidden otherwise (Resolved questions).
  const [showComments, setShowComments] = React.useState<boolean | null>(null);

  const findings = latestFindings(reviews ?? []);
  const byPath = findingsByPath(findings);
  const groups = buildRoleGroups(smartDiff, files, byPath);
  const totals = diffTotals(files);
  const openFindingCount = findings.filter((f) => !f.dismissed_at).length;
  const reviewed = hasAnyReview(reviews ?? []);

  const commentCount = comments?.length ?? 0;
  const effectiveShowComments = showComments ?? openFindingCount > 0;

  const commenting: DiffCommentApi = {
    comments: comments ?? [],
    canComment: !!canComment && !!prId,
    showComments: effectiveShowComments,
    posting: create.isPending,
    onSubmit: async (input) => {
      try {
        const res = await create.mutateAsync(input);
        setShowComments(true); // a just-posted comment shouldn't stay hidden
        return res;
      } catch (err) {
        notify.error(err instanceof Error ? err.message : "Couldn't post the comment to GitHub.");
        throw err;
      }
    },
  };

  const findingApi: DiffFindingApi = {
    findings,
    onAction: (finding, findingAction) => {
      action.mutate({ findingId: finding.id, action: findingAction, prId: prId ?? undefined });
    },
    pending: action.isPending,
    repoFullName,
    headSha,
  };

  return (
    <section>
      <SmartDiffHeader
        totals={totals}
        order={order}
        onOrderChange={setOrder}
        showComments={effectiveShowComments}
        onToggleComments={() => setShowComments(!effectiveShowComments)}
        commentCount={commentCount}
        openFindingCount={openFindingCount}
      />
      {order === "smart" ? (
        <div style={s.groups}>
          {groups.map((group) => (
            <RoleGroup key={group.role} group={group} reviewed={reviewed} commenting={commenting} findings={findingApi} />
          ))}
        </div>
      ) : (
        <DiffViewer files={files} commenting={commenting} findings={findingApi} />
      )}
    </section>
  );
}
