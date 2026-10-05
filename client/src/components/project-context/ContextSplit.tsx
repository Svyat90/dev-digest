"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { s } from "./styles";

interface Props {
  /** Left column: filter, list and anything that belongs under it. */
  children: ReactNode;
  /** Right column; `null` shows the "select a document" prompt. */
  preview: ReactNode | null;
}

/** Context-tab layout: list on the left, sticky preview on the right. */
export function ContextSplit({ children, preview }: Props) {
  const t = useTranslations("context");
  return (
    <div style={s.split}>
      <div>{children}</div>
      <aside style={s.previewColumn} aria-label={t("docs.previewRegion")}>
        {preview ?? <p style={s.previewPrompt}>{t("docs.selectPrompt")}</p>}
      </aside>
    </div>
  );
}
