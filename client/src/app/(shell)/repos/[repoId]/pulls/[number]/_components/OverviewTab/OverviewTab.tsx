"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { SectionLabel } from "@devdigest/ui";
import { useBlastRadius, useIntent, useRecomputeIntent, useResyncRepoIntel } from "@/lib/hooks";
import { BlastRadiusCard } from "./_components/BlastRadiusCard";
import { IntentCard } from "./_components/IntentCard";
import { s } from "./styles";

interface OverviewTabProps {
  prId: string | null | undefined;
  repoId: string;
  repoFullName: string | null;
  headSha: string | null | undefined;
  prBody: string | null | undefined;
}

export function OverviewTab({ prId, repoId, repoFullName, headSha, prBody }: OverviewTabProps) {
  const t = useTranslations("prReview");
  const { data: intent, isLoading, isError } = useIntent(prId);
  const recompute = useRecomputeIntent(prId);
  const blast = useBlastRadius(prId);
  const resync = useResyncRepoIntel(repoId);
  return (
    <>
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
      {prBody && (
        <section>
          <SectionLabel icon="MessageSquare">{t("detail.description")}</SectionLabel>
          <div style={s.descriptionBox}>{prBody}</div>
        </section>
      )}
    </>
  );
}
