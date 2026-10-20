import type { IconName } from "@devdigest/ui";

export interface DetailTab {
  key: string;
  labelKey: string;
  icon: IconName;
}

/** Skill detail tabs. Evals sits right after Preview (SPEC-06 AC17); an
   unknown `?tab=` falls back to `config`. */
export const TABS: readonly DetailTab[] = [
  { key: "config", labelKey: "detail.tabs.config", icon: "Settings" },
  { key: "preview", labelKey: "detail.tabs.preview", icon: "Eye" },
  { key: "evals", labelKey: "detail.tabs.evals", icon: "FlaskConical" },
  { key: "stats", labelKey: "detail.tabs.stats", icon: "Gauge" },
  { key: "versions", labelKey: "detail.tabs.versions", icon: "History" },
  { key: "context", labelKey: "detail.tabs.context", icon: "FileText" },
];

export const VALID_TABS: readonly string[] = TABS.map((t) => t.key);
