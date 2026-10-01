"use client";

import React, { useState } from "react";
import { useTranslations } from "next-intl";
import { Badge, Icon, Skeleton } from "@devdigest/ui";
import { usePrHistory } from "@/lib/hooks/blast";
import { githubPrUrl } from "@/lib/github-urls";
import { s } from "./styles";

export interface PriorPrsProps {
  prId: string | null | undefined;
  repoFullName: string | null;
}

/** Collapsed by default; the history is fetched only once the footer is first opened. */
export function PriorPrs({ prId, repoFullName }: PriorPrsProps) {
  const t = useTranslations("blast");
  const [open, setOpen] = useState(false);
  const q = usePrHistory(prId, open);
  const data = q.data;

  return (
    <div style={s.wrap}>
      <button
        type="button"
        style={s.toggle}
        aria-expanded={open}
        aria-label={t(open ? "history.collapse" : "history.expand")}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon.History size={14} />
        <span style={s.toggleTitle}>{t("history.title")}</span>
        {data && <Badge>{t("history.count", { count: data.history.length })}</Badge>}
        <span style={s.chevron}>
          {open ? <Icon.ChevronDown size={14} /> : <Icon.ChevronRight size={14} />}
        </span>
      </button>

      {open && (
        <div>
          {q.isLoading ? (
            <div style={s.skeletonStack} aria-busy="true">
              <Skeleton height={14} />
              <Skeleton height={14} width="70%" />
            </div>
          ) : q.isError ? (
            <span style={s.muted}>{t("history.error")}</span>
          ) : data ? (
            <div style={s.skeletonStack}>
              {data.degraded && data.reason && (
                <span style={s.status} role="status">
                  <Icon.AlertTriangle size={14} />
                  {t(`history.degraded.${data.reason}`)}
                </span>
              )}
              {data.history.length === 0 && !data.degraded && (
                <span style={s.muted}>{t("history.empty")}</span>
              )}
              {data.history.length > 0 && (
                <ul style={s.list}>
                  {data.history.map((item) => (
                    <li key={item.pr_number} style={s.row}>
                      <span style={s.bullet} aria-hidden="true" />
                      <div style={s.rowHead}>
                        {repoFullName ? (
                          <a
                            className="mono"
                            href={githubPrUrl(repoFullName, item.pr_number)}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={s.link}
                          >
                            #{item.pr_number}
                          </a>
                        ) : (
                          <span className="mono" style={s.link}>
                            #{item.pr_number}
                          </span>
                        )}
                        <span style={s.title}>{item.title}</span>
                      </div>
                      <span style={s.meta}>
                        {t("history.meta", {
                          date: new Date(item.merged_at).toLocaleDateString("en", {
                            year: "numeric",
                            month: "short",
                            day: "numeric",
                          }),
                          author: item.author,
                        })}
                      </span>
                      {item.files_overlap.length > 0 && (
                        <ul style={s.chips}>
                          {item.files_overlap.map((f) => (
                            <li key={f} style={s.chipItem}>
                              <span className="mono" title={f} style={s.chip}>
                                {f}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
