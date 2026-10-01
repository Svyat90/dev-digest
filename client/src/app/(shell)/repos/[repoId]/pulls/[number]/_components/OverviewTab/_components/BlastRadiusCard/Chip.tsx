import React from "react";
import { Icon, type IconName } from "@devdigest/ui";
import { s } from "./styles";

export interface ChipProps {
  icon: IconName;
  color: string;
  bg: string;
  children: string;
}

/** Mono chip that never outgrows its row: one over-long value is cut with an ellipsis, full text in `title`. */
export function Chip({ icon, color, bg, children }: ChipProps) {
  const I = Icon[icon];
  return (
    <span className="mono" title={children} style={{ ...s.chip, color, background: bg }}>
      <span style={s.chipIcon}>
        <I size={12} />
      </span>
      <span style={s.chipText}>{children}</span>
    </span>
  );
}
