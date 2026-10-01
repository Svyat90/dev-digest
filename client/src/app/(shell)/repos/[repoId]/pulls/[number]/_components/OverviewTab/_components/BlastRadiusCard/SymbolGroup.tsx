"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Icon } from "@devdigest/ui";
import type { DownstreamImpact } from "@devdigest/shared";
import { callerHref } from "./helpers";
import { s } from "./styles";

export interface SymbolGroupProps {
  group: DownstreamImpact;
  open: boolean;
  onToggle: () => void;
  repoFullName: string | null;
  indexSha: string | null;
  headSha: string | null | undefined;
}

/** One changed symbol: a collapsible row listing its callers, then endpoint chips, then cron chips. */
export function SymbolGroup({ group, open, onToggle, repoFullName, indexSha, headSha }: SymbolGroupProps) {
  const t = useTranslations("blast");
  return (
    <li style={s.group}>
      <button
        type="button"
        style={s.groupToggle}
        aria-expanded={open}
        aria-label={t(open ? "tree.collapse" : "tree.expand", { symbol: group.symbol })}
        onClick={onToggle}
      >
        {open ? <Icon.ChevronDown size={14} /> : <Icon.ChevronRight size={14} />}
        <span className="mono">{group.symbol}</span>
        <span style={s.groupCount}>{t("callerCount", { count: group.callers.length })}</span>
      </button>
      {open && (
        <div style={s.groupBody}>
          <ul style={s.callers}>
            {group.callers.map((c) => {
              const location = `${c.file}:${c.line}`;
              const href = callerHref(repoFullName, indexSha, headSha, c);
              return (
                <li key={`${location}:${c.name}`} style={s.caller}>
                  {href ? (
                    <a
                      className="mono"
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={t("tree.openOnGithub", { location })}
                      style={s.callerLink}
                    >
                      {location}
                    </a>
                  ) : (
                    <span className="mono">{location}</span>
                  )}
                  <span>{c.name}</span>
                </li>
              );
            })}
          </ul>
          {group.endpoints_affected.length > 0 && (
            <div style={s.chipRow}>
              <span style={s.chipLabel}>{t("tree.endpoints")}</span>
              {group.endpoints_affected.map((e) => (
                <Badge key={e} mono icon="Globe" color="var(--accent-text)" bg="var(--accent-bg)">
                  {e}
                </Badge>
              ))}
            </div>
          )}
          {group.crons_affected.length > 0 && (
            <div style={s.chipRow}>
              <span style={s.chipLabel}>{t("tree.crons")}</span>
              {group.crons_affected.map((c) => (
                <Badge key={c} mono icon="Clock" color="var(--info)" bg="var(--info-bg)">
                  {c}
                </Badge>
              ))}
            </div>
          )}
        </div>
      )}
    </li>
  );
}
