import type { CSSProperties } from "react";
import type { CaseDiffLine } from "@devdigest/shared";

const mono = "var(--font-mono, monospace)";

/** Co-located styles for the Case Editor input pieces. */
export const s = {
  section: { display: "flex", flexDirection: "column", gap: 8 } as CSSProperties,
  label: { fontSize: 12, fontWeight: 600, color: "var(--text-secondary)" } as CSSProperties,
  // Longhand border only: the invalid variant changes the colour facet.
  field: (invalid: boolean): CSSProperties => ({
    width: "100%",
    padding: "8px 10px",
    borderRadius: 7,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: invalid ? "var(--crit)" : "var(--border-strong)",
    background: "var(--bg-elevated)",
    color: "var(--text-primary)",
    fontSize: 13,
    outline: "none",
  }),
  code: (invalid: boolean): CSSProperties => ({
    ...s.field(invalid),
    fontFamily: mono,
    fontSize: 12,
    lineHeight: 1.5,
    resize: "vertical",
  }),
  meta: { display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12 } as CSSProperties,
  counter: (over: boolean): CSSProperties => ({
    marginLeft: "auto",
    color: over ? "var(--crit)" : "var(--text-muted)",
    fontVariantNumeric: "tabular-nums",
  }),
  issue: { color: "var(--crit)", fontSize: 12 } as CSSProperties,
  hint: { color: "var(--text-muted)", fontSize: 12 } as CSSProperties,
  preview: {
    margin: 0,
    padding: 0,
    listStyle: "none",
    fontFamily: mono,
    fontSize: 12,
    lineHeight: 1.5,
    maxHeight: 320,
    overflow: "auto",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: "var(--border)",
    borderRadius: 7,
    background: "var(--bg-elevated)",
  } as CSSProperties,
  previewRow: (kind: CaseDiffLine["kind"]): CSSProperties => ({
    display: "flex",
    gap: 8,
    padding: "0 8px",
    whiteSpace: "pre",
    color:
      kind === "file_header" || kind === "hunk_header" || kind === "meta"
        ? "var(--text-muted)"
        : kind === "add"
          ? "var(--ok)"
          : kind === "del"
            ? "var(--crit)"
            : "var(--text-primary)",
    background:
      kind === "add"
        ? "var(--ok-bg)"
        : kind === "del"
          ? "var(--crit-bg)"
          : kind === "hunk_header"
            ? "var(--bg-hover)"
            : "transparent",
    fontWeight: kind === "file_header" ? 600 : 400,
  }),
  lineNo: { width: 40, flexShrink: 0, textAlign: "right", color: "var(--text-muted)", userSelect: "none" } as CSSProperties,
  marker: { width: 10, flexShrink: 0, userSelect: "none" } as CSSProperties,
  empty: { padding: "10px 12px", color: "var(--text-muted)", fontSize: 12 } as CSSProperties,
  fileList: { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 4 } as CSSProperties,
  fileRow: { display: "flex", justifyContent: "space-between", gap: 12, fontFamily: mono, fontSize: 12 } as CSSProperties,
  fileStats: { color: "var(--text-muted)", fontVariantNumeric: "tabular-nums" } as CSSProperties,
  fieldset: { border: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 } as CSSProperties,
  row: { display: "flex", alignItems: "flex-end", gap: 12, flexWrap: "wrap" } as CSSProperties,
  radio: { display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13 } as CSSProperties,
  column: { display: "flex", flexDirection: "column", gap: 4 } as CSSProperties,
  number: { width: 96 } as CSSProperties,
  toolbar: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" } as CSSProperties,
};
