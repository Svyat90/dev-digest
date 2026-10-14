import { useTranslations } from "next-intl";

const DOT: Record<string, string> = {
  completed: "var(--ok)",
  running: "var(--warn)",
  failed: "var(--crit)",
};

/** A run's status as a coloured dot plus its text label (never colour alone). */
export function RunStatus({ status }: { status: string }) {
  const t = useTranslations("eval");
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--text-secondary)" }}>
      <span
        aria-hidden
        style={{ width: 7, height: 7, borderRadius: 99, background: DOT[status] ?? "var(--text-muted)" }}
      />
      {t(`runStatus.${status}`)}
    </span>
  );
}
