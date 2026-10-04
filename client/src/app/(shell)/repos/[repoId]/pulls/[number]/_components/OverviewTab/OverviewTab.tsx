"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { SectionLabel } from "@devdigest/ui";
import type { ReviewRecord } from "@devdigest/shared";
import { useBlastRadius, useIntent, useRecomputeIntent, useResyncRepoIntel } from "@/lib/hooks";
import { BlastRadiusCard } from "./_components/BlastRadiusCard";
import { IntentCard } from "./_components/IntentCard";
import { PrBriefBlock } from "./_components/PrBriefBlock";
import { s } from "./styles";

interface OverviewTabProps {
  prId: string | null | undefined;
  repoId: string;
  repoFullName: string | null;
  headSha: string | null | undefined;
  prBody: string | null | undefined;
  reviews: ReviewRecord[];
  diffPaths: ReadonlySet<string>;
  onNavigate: (file: string, line: number) => void;
}

export function OverviewTab({
  prId,
  repoId,
  repoFullName,
  headSha,
  prBody,
  reviews,
  diffPaths,
  onNavigate,
}: OverviewTabProps) {
  const t = useTranslations("prReview");
  const { data: intent, isLoading, isError } = useIntent(prId);
  const recompute = useRecomputeIntent(prId);
  const blast = useBlastRadius(prId);
  const resync = useResyncRepoIntel(repoId);
  return (
    <>
      <PrBriefBlock
        prId={prId}
        headSha={headSha}
        reviews={reviews}
        diffPaths={diffPaths}
        onNavigate={onNavigate}
      >
        <div style={s.topGrid}>
        <IntentCard
          intent={intent}
          isLoading={isLoading}
          isError={isError}
          headSha={headSha}
          onRecompute={() => recompute.mutate()}
          recomputing={recompute.isPending}
        />
        <BlastRadiusCard
          blast={blast.data}
          isLoading={blast.isLoading}
          isError={blast.isError}
          prId={prId}
          repoFullName={repoFullName}
          headSha={headSha}
          onResync={() => resync.mutate()}
          resyncing={resync.isPending}
        />
        </div>
      </PrBriefBlock>
      {prBody && (
        <section>
          <SectionLabel icon="MessageSquare">{t("detail.description")}</SectionLabel>
          <div style={s.descriptionBox}>{prBody}</div>
        </section>
      )}
    </>
  );
}
