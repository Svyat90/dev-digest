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
    <li style={s.riskItem}>
      <div style={s.chip}>
        <div style={s.chipMain}>
          <div style={s.chipTitle}>
            <I size={13} style={{ color: meta.color, flexShrink: 0 }} />
            <span>{risk.title}</span>
            <span style={s.severityWord(meta.color)}>{t(`severity.${risk.severity}`)}</span>
          </div>
          {risk.file_refs.length > 0 && (
            <div style={s.chipRefs}>
              {risk.file_refs.map((ref) => (
                <button
                  key={`${ref.file}:${ref.start_line}`}
                  type="button"
                  style={s.refButton}
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
              ))}
            </div>
          )}
        </div>
        <button
          type="button"
          style={s.chipToggle}
          aria-expanded={open}
          aria-label={t("toggleRisk", { title: risk.title })}
          onClick={() => setOpen((o) => !o)}
        >
          <Icon.ChevronDown size={14} style={open ? s.chevronOpen : undefined} />
        </button>
      </div>
      {missing && (
        <span style={s.notice} role="status">
          {t("notInDiff")}
        </span>
      )}
      {open && <p style={s.explanation}>{risk.explanation}</p>}
    </li>
  );
}
