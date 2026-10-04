"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { DocTypeTag } from "./DocTypeTag";
import { TokenEstimate } from "./TokenEstimate";
import { moveAttached, reorderAttached, toggleAttached, type DocRow } from "./helpers";
import { s } from "./styles";

interface Props {
  rows: DocRow[];
  onChange: (paths: string[]) => void;
  onPreview?: (path: string) => void;
  /** The row whose document is open in the preview; it gets the accent border. */
  selectedPath?: string | null;
}

/** Presentational list: tick to attach, drag or up/down to reorder attached rows. */
export function AttachableDocList({ rows, onChange, onPreview, selectedPath }: Props) {
  const t = useTranslations("context");
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [overPath, setOverPath] = useState<string | null>(null);
  const attached = rows.filter((r) => r.attached).map((r) => r.path);

  return (
    <ul style={s.list}>
      {rows.map((r) => {
        const idx = attached.indexOf(r.path);
        return (
          <li
            key={r.path}
            draggable={r.attached}
            onDragStart={() => r.attached && setDragFrom(idx)}
            onDragOver={(e) => {
              if (dragFrom == null || !r.attached) return;
              e.preventDefault();
              setOverPath(r.path);
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragFrom != null && r.attached) onChange(reorderAttached(attached, dragFrom, idx));
              setDragFrom(null);
              setOverPath(null);
            }}
            onDragEnd={() => {
              setDragFrom(null);
              setOverPath(null);
            }}
            aria-current={r.path === selectedPath ? "true" : undefined}
            style={s.row(overPath === r.path || r.path === selectedPath)}
          >
            <input
              type="checkbox"
              checked={r.attached}
              aria-label={t("docs.tab.attachLabel", { path: r.path })}
              onChange={() => onChange(toggleAttached(attached, r.path))}
            />
            {r.attached ? (
              <span style={s.handle} title={t("docs.tab.dragHandle")} aria-hidden="true">
                ⋮⋮
              </span>
            ) : null}
            <button
              type="button"
              style={s.pathBtn}
              disabled={!r.found || !onPreview}
              onClick={() => onPreview?.(r.path)}
            >
              {r.path}
            </button>
            <DocTypeTag type={r.type} />
            {r.found ? (
              <TokenEstimate tokens={r.tokens} truncated={r.truncated} />
            ) : (
              <span style={s.badge}>{t("docs.notFound")}</span>
            )}
            {r.attached ? (
              <span style={s.moves}>
                <button
                  type="button"
                  style={s.iconBtn}
                  aria-label={t("docs.tab.moveUp", { path: r.path })}
                  onClick={() => onChange(moveAttached(attached, r.path, -1))}
                >
                  ↑
                </button>
                <button
                  type="button"
                  style={s.iconBtn}
                  aria-label={t("docs.tab.moveDown", { path: r.path })}
                  onClick={() => onChange(moveAttached(attached, r.path, 1))}
                >
                  ↓
                </button>
              </span>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
