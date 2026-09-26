import type { SmartDiffRole } from "@devdigest/shared";

/**
 * CSS variable per role, used for the group header's coloured square. Colours
 * come from the design system's semantic tokens, not raw hex, so they follow
 * the theme (light/dark) automatically.
 */
export const ROLE_COLOR: Record<SmartDiffRole, string> = {
  core: "var(--accent)",
  tests: "var(--ok)",
  wiring: "var(--info)",
  docs: "var(--sugg)",
  boilerplate: "var(--text-muted)",
};

/**
 * Roles whose group starts collapsed: docs and boilerplate are skimmed, not
 * read line by line, so they open on demand instead of pushing the reviewable
 * groups below the fold.
 */
export const COLLAPSED_BY_DEFAULT: ReadonlySet<SmartDiffRole> = new Set(["docs", "boilerplate"]);

/** i18n key (under the `prReview` namespace) for each role's short label. */
export const ROLE_LABEL_KEY: Record<SmartDiffRole, string> = {
  core: "smartDiff.coreLabel",
  tests: "smartDiff.testsLabel",
  wiring: "smartDiff.wiringLabel",
  docs: "smartDiff.docsLabel",
  boilerplate: "smartDiff.boilerplateLabel",
};
