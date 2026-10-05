# specs — server

Written feature specs for the `server` package, read before implementing one.
Linked from `server/CLAUDE.md` › *Read when*.

- **[`review-flow.md`](review-flow.md)** — the review cycle end to end: the
  module's endpoints, round/run creation, what one run does, the invariants a
  change must not break, and how the PR list's derived columns are computed.
- **[`skills.md`](skills.md)** — skills: the invariants (S1–S10), the data
  model, the API surface, and the import parsing rules.
- **[`conventions.md`](conventions.md)** — the Conventions Extractor: the
  invariants (C1–C10), the data model, the API surface, and how it produces
  a skill.
- **[`intent.md`](intent.md)** — the Intent Layer: the invariants (I1–I11),
  the web-fetch SSRF policy, the data model, the API surface, and how intent
  reaches the reviewer prompt.
- **[`smart-diff.md`](smart-diff.md)** — Smart Diff: the invariants
  (SD1–SD11), the role classification precedence and its contested cases,
  the `finding_lines` rule, and how the client derives its groups, dot and
  counters from the same data.
- **[`layering.md`](layering.md)** — server layering: invariant L1 (a
  `routes.ts` never imports `db/` or `drizzle-orm`), why, and how
  `arch:check` enforces it.
- **[`blast-radius.md`](blast-radius.md)** — Blast Radius (L04): the
  invariants (BR1–BR13), the `BlastRadiusResponse` contract, the per-symbol
  caller-cap fix in the repo-intel facade, the Overview card, Prior PRs (PH1–PH7) and the
  `get_blast_radius` MCP tool, mapped to the P1/P2/P3 acceptance criteria.
