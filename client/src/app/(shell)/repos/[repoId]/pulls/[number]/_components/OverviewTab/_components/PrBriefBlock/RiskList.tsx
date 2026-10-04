"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { Risk, RiskSeverity } from "@devdigest/shared";
import { refLabel } from "./helpers";
import { s } from "./styles";

const SEVERITY: Record<RiskSeverity, { color: string; icon: "AlertOctagon" | "AlertTriangle" | "Info" }> = {
  high: { color: "var(--crit)", icon: "AlertOctagon" },
  medium: { color: "var(--warn)", icon: "AlertTriangle" },
  low: { color: "var(--sugg)", icon: "Info" },
};

export interface RiskListProps {
  risks: Risk[];
  diffPaths: ReadonlySet<string>;
  onNavigate: (file: string, line: number) => void;
}

/** Stored (server) order is rendered as is. Model text is plain React text only. */
export function RiskList({ risks, diffPaths, onNavigate }: RiskListProps) {
  const t = useTranslations("brief");
  if (risks.length === 0) return <span style={s.muted}>{t("noRisks")}</span>;
  return (
    <ul style={s.list}>
      {risks.map((risk, i) => (
        <RiskItem
          key={`${risk.title}:${i}`}
          risk={risk}
          diffPaths={diffPaths}
          onNavigate={onNavigate}
        />
      ))}
    </ul>
  );
}

function RiskItem({ risk, diffPaths, onNavigate }: { risk: Risk } & Omit<RiskListProps, "risks">) {
  const t = useTranslations("brief");
  const [open, setOpen] = React.useState(false);
  const [missing, setMissing] = React.useState<string | null>(null);
  const meta = SEVERITY[risk.severity];
  const I = Icon[meta.icon];
  return (
    <li>
      <button type="button" style={s.riskHead} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span style={s.severity(meta.color)}>
          <I size={14} />
          {t(`severity.${risk.severity}`)}
        </span>
        <span>{risk.title}</span>
      </button>
      {open && <p style={s.explanation}>{risk.explanation}</p>}
      {risk.file_refs.length > 0 && (
        <div style={s.refRow}>
          {risk.file_refs.map((ref) => (
            <span key={`${ref.file}:${ref.start_line}`}>
              <button
                type="button"
                style={s.linkButton}
                onClick={() => {
                  if (diffPaths.has(ref.file)) {
                    setMissing(null);
                    onNavigate(ref.file, ref.start_line);
                  } else {
                    setMissing(ref.file);
                  }
                }}
              >
                {refLabel(ref)}
              </button>
              {missing === ref.file && (
                <span style={s.notice} role="status">
                  {t("notInDiff")}
                </span>
              )}
            </span>
          ))}
        </div>
      )}
    </li>
  );
}
