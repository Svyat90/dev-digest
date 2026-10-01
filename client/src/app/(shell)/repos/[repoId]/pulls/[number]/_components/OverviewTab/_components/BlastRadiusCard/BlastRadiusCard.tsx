"use client";

import React, { useState } from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, Icon, SectionLabel, Skeleton } from "@devdigest/ui";
import type { BlastRadiusResponse } from "@devdigest/shared";
import { PriorPrs } from "./_components/PriorPrs";
import { SymbolGroup } from "./SymbolGroup";
import { blastCounts, isAtLimit } from "./helpers";
import { s } from "./styles";

export interface BlastRadiusCardProps {
  blast: BlastRadiusResponse | undefined;
  isLoading: boolean;
  isError: boolean;
  prId: string | null | undefined;
  repoFullName: string | null;
  /** The PR head; only a fallback when the index has no commit to pin links to. */
  headSha: string | null | undefined;
  onResync: () => void;
  resyncing: boolean;
}

/** Presentational: `OverviewTab` owns the hooks and passes the state in. */
export function BlastRadiusCard({
  blast,
  isLoading,
  isError,
  prId,
  repoFullName,
  headSha,
  onResync,
  resyncing,
}: BlastRadiusCardProps) {
  const t = useTranslations("blast");
  // The first group is open by default; this set holds the groups the user flipped.
  const [flipped, setFlipped] = useState<ReadonlySet<string>>(new Set());
  const toggle = (symbol: string) =>
    setFlipped((prev) => {
      const next = new Set(prev);
      if (!next.delete(symbol)) next.add(symbol);
      return next;
    });

  const label = <SectionLabel icon="GitBranch">{t("title")}</SectionLabel>;

  if (isLoading) {
    return (
      <section aria-busy="true">
        {label}
        <div style={s.card}>
          <div style={s.skeletonStack}>
            <Skeleton height={16} />
            <Skeleton height={16} width="80%" />
            <Skeleton height={16} width="60%" />
          </div>
        </div>
      </section>
    );
  }

  if (isError || !blast) {
    return (
      <section>
        {label}
        <div style={s.card}>
          <span style={s.muted}>{t("error")}</span>
        </div>
      </section>
    );
  }

  const counts = blastCounts(blast);
  const stats: [keyof typeof counts, number][] = [
    ["symbols", counts.symbols],
    ["callers", counts.callers],
    ["endpoints", counts.endpoints],
    ["crons", counts.crons],
  ];
  const first = blast.downstream[0]?.symbol;

  return (
    <section>
      {label}
      <div style={s.card}>
        {blast.degraded && blast.reason && (
          <div style={s.degraded} role="status">
            <Badge icon="AlertTriangle" color="var(--warn)" bg="var(--warn-bg)">
              {t("degraded.badge")}
            </Badge>
            <span>{t(`degraded.reason.${blast.reason}`)}</span>
            <Button kind="secondary" size="sm" icon="RefreshCw" onClick={onResync} loading={resyncing}>
              {t("resync")}
            </Button>
          </div>
        )}

        {blast.downstream.length === 0 ? (
          <span style={s.muted}>{t("noDownstream", { count: counts.symbols })}</span>
        ) : (
          <>
            <dl style={s.stats}>
              {stats.map(([key, value]) => (
                <div key={key} style={s.stat}>
                  <dt style={s.statLabel}>{t(`stat.${key}`)}</dt>
                  <dd style={s.statValue}>{value}</dd>
                </div>
              ))}
            </dl>
            <ul style={s.groups}>
              {blast.downstream.map((group) => (
                <SymbolGroup
                  key={group.symbol}
                  group={group}
                  open={(group.symbol === first) !== flipped.has(group.symbol)}
                  onToggle={() => toggle(group.symbol)}
                  repoFullName={repoFullName}
                  indexSha={blast.index_sha}
                  headSha={headSha}
                />
              ))}
            </ul>
            {blast.downstream.some((g) => isAtLimit(g, blast.limits)) && (
              <span style={s.limitHint}>
                {t("limitHint", { max: blast.limits.max_callers_per_symbol })}
              </span>
            )}
          </>
        )}

        <PriorPrs prId={prId} repoFullName={repoFullName} />
      </div>
    </section>
  );
}
