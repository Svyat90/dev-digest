# Server layering — the API never touches the database

Status: approved · Package: server

## Invariant L1 — `api/` does not import `db/` directly

The API layer of the server — every `server/src/modules/<name>/routes.ts` — does
not import `server/src/db/` (the schema or the client) or `drizzle-orm`, and does
not query `container.db` itself.

A route does three things only:

1. validates the request with its Zod schema;
2. resolves the caller's workspace with `getContext`;
3. calls its module's service (or, in a CRUD module, its `repository.ts`).

Every query lives in `repository.ts`. A new endpoint that needs data adds a
repository method and calls it through the service.

## Why

- Workspace scoping is enforced in one place, the repository. A query written in
  a route can forget the `workspace_id` filter and leak another tenant's rows.
- Routes stay testable without a database, and the schema can change without
  touching the HTTP layer.

## Enforcement

`pnpm arch:check` (dependency-cruiser rule `routes-do-not-touch-the-db`). Eight
routes that predate the rule are listed in the known-violations baseline; a new
violation is never added to the baseline. A review must flag any diff that adds
an import of `db/` or `drizzle-orm` to a `routes.ts`.
