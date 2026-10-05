"use client";

import { useTranslations } from "next-intl";
import { Markdown } from "@devdigest/ui";
import { s } from "./styles";

/** Read-only markdown preview of one document (no raw HTML is rendered). */
export function DocPreview({
  path,
  content,
  onClose,
}: {
  path: string;
  content: string;
  onClose?: () => void;
}) {
  const t = useTranslations("context");
  return (
    <section aria-label={t("docs.preview")} style={s.preview}>
      <header style={s.previewHead}>
        <code style={s.path}>{path}</code>
        {onClose ? (
          <button type="button" onClick={onClose} style={s.iconBtn}>
            {t("docs.closePreview")}
          </button>
        ) : null}
      </header>
      <div className="dd-md">
        <Markdown>{content}</Markdown>
      </div>
    </section>
  );
}
