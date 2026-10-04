"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Icon, SectionLabel, Skeleton } from "@devdigest/ui";
import type { ReviewRecord } from "@devdigest/shared";
import { useGenerateBrief, usePrBrief } from "@/lib/hooks";
import { VerdictBanner } from "@/components/verdict-banner";
import { failureMessageKey, missingLabelKeys, newestReview } from "./helpers";
import { RiskList } from "./RiskList";
import { ReviewFocusList } from "./ReviewFocusList";
import { s } from "./styles";

export interface PrBriefBlockProps {
  prId: string | null | undefined;
  headSha: string | null | undefined;
  reviews: ReviewRecord[];
  diffPaths: ReadonlySet<string>;
  onNavigate: (file: string, line: number) => void;
  /** The Intent and Blast radius cards. */
  children?: React.ReactNode;
}

export function PrBriefBlock({
  prId,
  headSha,
  reviews,
  diffPaths,
  onNavigate,
  children,
}: PrBriefBlockProps) {
  const t = useTranslations("brief");
  const query = usePrBrief(prId);
  const gen = useGenerateBrief(prId);
  const brief = query.data ?? null;
  const stale = !!brief && !!headSha && brief.head_sha !== headSha;
  const review = newestReview(reviews);
  const blockers = review
    ? review.findings.filter((f) => f.severity === "CRITICAL" && !f.dismissed_at).length
    : 0;

  const generate = () => gen.mutate();

  const banner =
    review && review.verdict ? (
      <VerdictBanner
        verdict={review.verdict}
        summary={review.summary}
        score={review.score}
        findingsCount={review.findings.length}
        blockers={blockers}
        agentName={review.agent_name}
      />
    ) : null;

  let body: React.ReactNode;
  if (gen.isPending || query.isLoading) {
    body = (
      <div style={s.card} aria-busy="true" aria-label={t("generating")}>
        <div style={s.skeletonStack}>
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} height={16} width={`${100 - i * 12}%`} />
          ))}
        </div>
      </div>
    );
  } else if (!brief) {
    body = null;
  } else {
    body = (
      <div style={s.card}>
        <p style={s.summary}>{brief.summary}</p>
        {brief.missing_inputs.length > 0 && (
          <div style={s.muted}>
            {t("missing.label")}:{" "}
            {missingLabelKeys(brief.missing_inputs)
              .map((k) => t(k))
              .join(", ")}
          </div>
        )}
        <div>
          <h3 style={s.sectionTitle}>{t("riskAreas")}</h3>
          <RiskList risks={brief.risks.risks} diffPaths={diffPaths} onNavigate={onNavigate} />
        </div>
        <div>
          <h3 style={s.sectionTitle}>{t("reviewFocus")}</h3>
          <div style={s.muted}>{t("reviewFocusHint")}</div>
          <ReviewFocusList items={brief.review_focus} diffPaths={diffPaths} onNavigate={onNavigate} />
        </div>
        <div style={s.muted}>
          {t("generatedAt", { date: new Date(brief.generated_at).toLocaleString() })}
        </div>
      </div>
    );
  }

  return (
    <section style={s.root}>
      {banner}
      <div style={s.headerRow}>
        <SectionLabel icon="Sparkles">{t("block.title")}</SectionLabel>
        {stale && (
          <span style={s.staleHint} role="status">
            <Icon.AlertTriangle size={14} />
            {t("outOfDate")}
          </span>
        )}
        <span style={s.spacer}>
          <Button
            kind={brief ? "secondary" : "primary"}
            size="sm"
            icon={brief ? "RefreshCw" : "Sparkles"}
            onClick={generate}
            disabled={gen.isPending}
          >
            {brief ? t("refresh") : t("generate")}
          </Button>
        </span>
      </div>
      {gen.error && !gen.isPending && (
        <div style={s.error} role="alert">
          <span>{t(failureMessageKey(gen.error))}</span>
          <Button kind="secondary" size="sm" onClick={generate}>
            {t("retry")}
          </Button>
        </div>
      )}
      {body}
      {children && <div style={s.cards}>{children}</div>}
    </section>
  );
}
