import type { CSSProperties } from "react";

/** Co-located styles for the AgentEditor shell. */
export const s = {
  // minHeight 0 down the flex chain keeps `body` the scroll container (sticky
  // children such as the Context tab preview bind to it).
  wrap: { flex: 1, display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0 } satisfies CSSProperties,
  tabsBar: { marginTop: 14 } satisfies CSSProperties,
  body: { flex: 1, minHeight: 0, overflow: "auto", padding: 28 } satisfies CSSProperties,
} as const;
