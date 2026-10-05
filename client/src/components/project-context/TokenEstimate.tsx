"use client";

import { useTranslations } from "next-intl";
import { formatTokenCount } from "@/lib/format";
import { s } from "./styles";

/** "≈ N tokens" plus a "truncated" badge; an em dash when the count is unknown. */
export function TokenEstimate({
  tokens,
  truncated,
}: {
  tokens: number | null;
  truncated?: boolean;
}) {
  const t = useTranslations("context");
  return (
    <span style={s.tokens}>
      {tokens == null ? formatTokenCount(null) : t("docs.tokens", { count: formatTokenCount(tokens) })}
      {truncated ? <span style={s.badge}>{t("docs.truncated")}</span> : null}
    </span>
  );
}
