"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { DownstreamImpact } from "@devdigest/shared";
import { Chip } from "./Chip";
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
        style={open ? s.groupToggle : { ...s.groupToggle, ...s.groupToggleIdle }}
        aria-expanded={open}
        aria-label={t(open ? "tree.collapse" : "tree.expand", { symbol: group.symbol })}
        onClick={onToggle}
      >
        <span style={s.groupIcon}>
          {open ? <Icon.ChevronDown size={14} /> : <Icon.ChevronRight size={14} />}
        </span>
        <span style={s.groupIcon}>
          <Icon.Code size={14} />
        </span>
        <span className="mono" style={s.groupSymbol}>
          {group.symbol}
        </span>
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
                  <span style={s.callerArrow} aria-hidden="true">
                    <Icon.CornerDownRight size={12} />
                  </span>
                  {href ? (
                    <a
                      className="mono"
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={t("tree.openOnGithub", { location })}
                      style={{ ...s.callerLocation, ...s.callerLink }}
                    >
                      {location}
                    </a>
                  ) : (
                    <span className="mono" style={s.callerLocation}>
                      {location}
                    </span>
                  )}
                  <span style={s.callerName}>{c.name}</span>
                </li>
              );
            })}
          </ul>
          {group.endpoints_affected.length > 0 && (
            <div style={s.chipRow} role="group" aria-label={t("tree.endpoints")}>
              {group.endpoints_affected.map((e) => (
                <Chip key={e} icon="Globe" color="var(--accent-text)" bg="var(--accent-bg)">
                  {e}
                </Chip>
              ))}
            </div>
          )}
          {group.crons_affected.length > 0 && (
            <div style={s.chipRow} role="group" aria-label={t("tree.crons")}>
              {group.crons_affected.map((c) => (
                <Chip key={c} icon="Clock" color="var(--warn)" bg="var(--warn-bg)">
                  {c}
                </Chip>
              ))}
            </div>
          )}
        </div>
      )}
    </li>
  );
}
