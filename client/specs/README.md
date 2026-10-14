# specs — client

Written feature specs for the `client` package, read before implementing one.
Linked from `client/CLAUDE.md` › *Read when*.

- **[`pages.md`](pages.md)** — every route and the data it leans on, the
  navigation rules, the URL-state contract (`?status=`, `?tab=`, `?trace=`,
  `?severity=`, `?range=`) and the presentation invariants that hold across
  screens. Includes the Conventions page (`server/specs/conventions.md`) and
  the eval dashboards, `/evals` and `/evals/:agentId`
  (`server/specs/eval-dashboard.md`), the skill detail's `?tab=evals` and the
  Case Editor dialog on both Evals tabs (`server/specs/case-editor.md`).
