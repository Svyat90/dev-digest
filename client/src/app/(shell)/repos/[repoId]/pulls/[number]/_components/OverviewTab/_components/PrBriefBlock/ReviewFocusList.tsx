"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { ReviewFocusItem } from "@devdigest/shared";
import { s } from "./styles";

export interface ReviewFocusListProps {
  items: ReviewFocusItem[];
  diffPaths: ReadonlySet<string>;
  onNavigate: (file: string, line: number) => void;
}

/** A reading order: each item opens Files changed at its file and line. */
export function ReviewFocusList({ items, diffPaths, onNavigate }: ReviewFocusListProps) {
  const t = useTranslations("brief");
  const [missing, setMissing] = React.useState<string | null>(null);
  if (items.length === 0) return <span style={s.muted}>{t("noFocus")}</span>;
  return (
    <ol style={{ ...s.list, paddingLeft: 20, listStyle: "decimal" }}>
      {items.map((item) => {
        const key = `${item.file}:${item.line}`;
        return (
          <li key={key}>
            <button
              type="button"
              style={s.linkButton}
              onClick={() => {
                if (diffPaths.has(item.file)) {
                  setMissing(null);
                  onNavigate(item.file, item.line);
                } else {
                  setMissing(key);
                }
              }}
            >
              {`${key} — ${item.reason}`}
            </button>
            {missing === key && (
              <span style={s.notice} role="status">
                {t("notInDiff")}
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
