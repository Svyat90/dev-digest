"use client";

import { useTranslations } from "next-intl";
import type { CaseDiffParse } from "@devdigest/shared";
import { lineBody, lineMarker } from "./helpers";
import { s } from "./styles";

/**
 * Read-only preview of the pasted diff (SPEC-06 AC2): one row per parsed line
 * with its new-side number and a "+" / "−" marker as text next to its colour.
 * Every line renders as a React text child, never as HTML.
 */
export function DiffPreview({ parse }: { parse: CaseDiffParse }) {
  const t = useTranslations("eval");
  if (parse.lines.length === 0) return <div style={s.empty}>{t("caseEditor.previewEmpty")}</div>;

  return (
    <ol style={s.preview} aria-label={t("caseEditor.preview")}>
      {parse.lines.map((line) => {
        const marker = lineMarker(line.kind);
        return (
          <li key={line.sourceLine} style={s.previewRow(line.kind)}>
            <span style={s.lineNo}>{line.newLine ?? ""}</span>
            {marker !== null && <span style={s.marker}>{marker}</span>}
            <span>{lineBody(line)}</span>
          </li>
        );
      })}
    </ol>
  );
}
