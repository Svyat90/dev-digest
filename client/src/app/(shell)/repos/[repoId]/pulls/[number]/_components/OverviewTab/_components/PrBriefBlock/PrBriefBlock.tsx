"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, Icon, SectionLabel, Skeleton } from "@devdigest/ui";
import type { ReviewRecord } from "@devdigest/shared";
import { useGenerateBrief, usePrBrief } from "@/lib/hooks";
import { VerdictBanner } from "@/components/verdict-banner";
import { failureMessageKey, missingLabelKeys, newestReview } from "./helpers";
import { RiskList } from "./RiskList";
import { ReviewFocusList } from "./ReviewFocusList";
import { s } from "./styles";

export interface PrBriefSlots {
  /** The Risk areas section, or `null` while no brief is stored. */
  riskAreas: React.ReactNode;
}

export interface PrBriefBlockProps {
  prId: string | null | undefined;
  headSha: string | null | undefined;
  reviews: ReviewRecord[];
  diffPaths: ReadonlySet<string>;
  onNavigate: (file: string, line: number) => void;
  /** Renders the Intent and Blast radius cards; the Risk areas go inside the Intent card. */
  children?: (slots: PrBriefSlots) => React.ReactNode;
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
  const busy = gen.isPending || query.isLoading;
  const stale = !!brief && !!headSha && brief.head_sha !== headSha;
  const review = newestReview(reviews);
  const blockers = review
    ? review.findings.filter((f) => f.severity === "CRITICAL" && !f.dismissed_at).length
    : 0;

  const generate = () => gen.mutate();

  const action = (
    <>
      {stale && (
        <span style={s.staleHint} role="status">
          <Icon.AlertTriangle size={14} />
          {t("outOfDate")}
        </span>
      )}
      {brief ? (
        <Button
          kind="ghost"
          size="sm"
          icon="RefreshCw"
          aria-label={t("refresh")}
          title={t("refresh")}
          onClick={generate}
          disabled={gen.isPending}
        />
      ) : (
        <Button kind="primary" size="sm" icon="Sparkles" onClick={generate} disabled={gen.isPending}>
          {t("generate")}
        </Button>
      )}
    </>
  );

  let content: React.ReactNode;
  if (busy) {
    content = (
      <div style={s.skeletonStack} aria-busy="true" aria-label={t("generating")}>
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} height={14} width={`${100 - i * 15}%`} />
        ))}
      </div>
    );
  } else if (!brief) {
    content = (
      <div>
        <div style={s.emptyTitle}>{t("empty.title")}</div>
        <div style={s.muted}>{t("empty.hint")}</div>
      </div>
    );
  } else {
    content = (
      <div style={s.meta}>
        {brief.missing_inputs.length > 0 && (
          <span>
            {t("missing.label")}:{" "}
            {missingLabelKeys(brief.missing_inputs)
              .map((k) => t(k))
              .join(", ")}
          </span>
        )}
        <span>{t("generatedAt", { date: new Date(brief.generated_at).toLocaleString() })}</span>
      </div>
    );
  }

  const extra = (
    <>
      {gen.error && !gen.isPending && (
        <div style={s.error} role="alert">
          <span>{t(failureMessageKey(gen.error))}</span>
          <Button kind="secondary" size="sm" onClick={generate}>
            {t("retry")}
          </Button>
        </div>
      )}
      {content}
    </>
  );

  const summary = brief && !busy ? brief.summary : null;

  const topCard =
    review && review.verdict ? (
      <VerdictBanner
        verdict={review.verdict}
        summary={summary}
        score={review.score}
        findingsCount={review.findings.length}
        blockers={blockers}
        agentName={review.agent_name}
        action={action}
      >
        {extra}
      </VerdictBanner>
    ) : (
      <div style={s.plainCard}>
        <div style={s.plainMain}>
          {summary && <p style={s.summary}>{summary}</p>}
          {extra}
        </div>
        <div style={s.action}>{action}</div>
      </div>
    );

  const riskAreas = brief ? (
    <div>
      <h3 style={s.subTitle}>
        <Icon.AlertTriangle size={14} />
        {t("riskAreas")}
      </h3>
      <RiskList risks={brief.risks.risks} diffPaths={diffPaths} onNavigate={onNavigate} />
    </div>
  ) : null;

  return (
    <section style={s.root}>
      <div>
        <SectionLabel icon="FileText">{t("block.title")}</SectionLabel>
        {topCard}
      </div>
      {children?.({ riskAreas })}
      {brief && (
        <section style={s.card}>
          <SectionLabel icon="ListChecks">
            {t("reviewFocusTitle")}{" "}
            <Badge color="var(--accent-text)" bg="var(--accent-bg)">
              {brief.review_focus.length}
            </Badge>
          </SectionLabel>
          <ReviewFocusList items={brief.review_focus} diffPaths={diffPaths} onNavigate={onNavigate} />
        </section>
      )}
    </section>
  );
}
