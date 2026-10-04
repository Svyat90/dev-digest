# Spec: Project Context — discovery and attachment
Spec ID: SPEC-01-project-context
Status: approved
Supersedes: none
Packages: server, client
Depends on: none

## Problem and user

The people hurt are **agent and skill authors** (they configure reviewers in
the studio) and **developers whose pull requests are reviewed**. A project
already writes down its rules in markdown — specs, architecture docs, insight
files ("module `api/` does not import `db/` directly", "public endpoints are
rate-limited per client IP"). The reviewer never sees them: its prompt holds the
agent's system prompt, skills, repo-intel context and the diff, and the
`## Project context` slot that exists in the prompt has never been filled
(every run records `specs_read: []`). A PR that breaks a written project rule is
therefore judged only on generic criteria, and nobody can tell from a run
whether the reviewer knew the rule.

Why it matters: this is the smallest feature that shows whether giving the
reviewer a written spec changes what it finds. It needs no automatic retrieval
and no extra model call, so its effect can be checked directly: attach a
document, open a PR that breaks it, and see whether the reviewer cites that
document — and see in the trace exactly what text the reviewer received.

The feature is split in two specs. This one covers finding documents, seeing
their token cost and attaching them to agents and skills. Reading them at run
time, putting them into the prompt and showing them in the trace is
SPEC-02-context-injection.

## Goals / Non-goals

Goals:

- Let the user see every markdown document under the project's spec, docs and
  insights folders, plus every `INSIGHTS.md` file, with a preview — because the
  user cannot attach what they cannot find.
- Let the user attach documents to an agent, and to a skill so that every agent
  using it inherits them, from the agent and skill editors and from the Project
  Context page — because rules are usually shared by several reviewers, and
  attaching them one agent at a time drifts.
- Show the token cost of each document and of the attached set before a run —
  because every attached token is paid on every prompt of every run.
- Show which agents and skills use a document — because an author changing or
  detaching a rule needs to know who depends on it.

Non-goals:

- Reading documents at run time, the prompt section and the trace — that is
  SPEC-02-context-injection.
- Automatic selection of relevant documents from the PR content — a separate
  feature (course brief); here the user picks by hand.
- Chunking, embedding or semantic indexing of documents — the design's
  "Indexed: 12 files · 1,240 chunks" footer belongs to retrieval, which this
  feature does not do (user answer).
- Creating, editing, uploading or deleting documents from the studio — the
  repository is the source of truth; the design's Edit toggle, new-file,
  new-folder and upload controls are out of scope (user answer).
- A "coverage" score for a document — the design's "78 COVERAGE" ring has no
  definition and is out of scope (user answer).
- Editing the search roots from the UI — the roots are server configuration
  (course brief).
- Versioning attachments — changing them does not create a new agent or skill
  version, the same as toggling a skill link (user answer).
- How discovery, the storage of attachments or the token count are built — that
  is for the implementation planner.

## User stories

- US1: As an agent or skill author, I want to browse and preview every markdown document in the project's spec, docs and insights folders, so that I can find the documents that state rules my reviewer must enforce.
- US2: As an agent author, I want to attach documents to an agent and set their order on its Context tab, so that every run of that agent reviews against those rules.
- US3: As a skill author, I want to attach documents to a skill, so that every agent using the skill inherits them without attaching them one by one.
- US4: As an agent or skill author, I want to see the token size of each document and of the attached set, so that I know how much each prompt grows before I run it.
- US5: As an agent or skill author, I want to see which agents and skills use a document, so that I know who is affected before I detach it or change it in the repository.

## Acceptance criteria (EARS)

- AC1 [US1]: WHEN the user opens the Project Context page for a repository, the system shall list every file ending in `.md` found at any depth inside a folder named after one of the configured search roots (default `specs`, `docs`, `insights`), and every file named `INSIGHTS.md` anywhere, in that repository's local copy on its default branch, each with its repository-relative path and a type tag.
- AC2 [US1]: The system shall set a document's type tag to the name of the innermost search-root folder that contains it (`docs/specs/x.md` → `specs`), and to `insights` for an `INSIGHTS.md` file outside every search root.
- AC3 [US1]: IF more than 500 documents are found in a repository, THEN the system shall list the first 500 in path order and show a message stating how many more were not listed, while the filter of AC4 still searches every document found.
- AC4 [US1]: WHEN the user types in the filter field of the Project Context page or of a Context tab, the system shall show only the documents whose path contains the typed text, ignoring letter case.
- AC5 [US1]: WHEN the user selects a document on the Project Context page or presses its Preview control on a Context tab, the system shall show the document rendered as read-only markdown, without running scripts or rendering raw HTML contained in it.
- AC6 [US1]: IF the repository has no local copy yet, THEN the system shall show a "repository not cloned yet" message on the Project Context page and on the Context tabs instead of an empty list.
- AC7 [US1]: IF the repository's local copy contains no document matching AC1, THEN the system shall show an empty state that names the configured search roots.
- AC8 [US2]: The system shall list on the agent and skill Context tabs the documents of the repository currently selected in the studio and name that repository on the tab.
- AC9 [US2]: WHEN the user ticks or unticks a document on an agent's Context tab, the system shall save that agent's attachments so that the change is still shown after a page reload.
- AC10 [US2, US3]: The system shall store an attachment as the document's repository-relative path only and never as a copy of its text, so that a run on any repository resolves the path in that PR's repository.
- AC11 [US2]: WHEN the user drags an attached document to a new position on an agent's Context tab, the system shall save the new order.
- AC12 [US2]: The system shall show on an agent's Context tab the number of attached documents out of the documents listed, in the form "N of M attached".
- AC13 [US2, US3]: The system shall list on an agent's Context tab, read-only and below the agent's own documents, the documents attached to each skill active for that agent, each marked with the name of the skill it comes from.
- AC14 [US3]: WHEN the user ticks, unticks or reorders a document in a skill's "Project context to use" section, the system shall save the skill's attachments in the order shown.
- AC15 [US2, US3]: WHEN the user picks an agent or a skill in the "Attach to…" control of a document selected on the Project Context page, the system shall attach that document to it after the documents it already has, leaving an existing attachment of the same path as it is.
- AC16 [US5]: WHEN the user selects a document on the Project Context page, the system shall show "Used by N agents · M skills", counting the agents and skills that have that path attached.
- AC17 [US4]: The system shall show next to every listed document its size in tokens, measured with the same counter the run uses for prompt sections and marked as an estimate with "≈".
- AC18 [US4]: IF a document is longer than 4,000 tokens, THEN the system shall mark it "truncated" in every list and count it as 4,000 tokens in any total.
- AC19 [US4]: WHEN the set of attached documents on an agent's or a skill's Context tab changes, the system shall update the shown total token count within the same view without a page reload, counting on an agent's tab each distinct document once, including the documents its active skills add.
- AC20 [US2, US3]: IF a request to attach a document gives a path that is absolute, contains a `..` segment, does not end in `.md`, or is neither inside a configured search root nor named `INSIGHTS.md`, THEN the system shall reject the request with a validation error and store nothing.
- AC21 [US2, US3]: IF an attached path is not found in the repository shown on a Context tab, THEN the system shall still show it as attached and marked "not found", so the user can detach it.
- AC22 [US2, US3]: WHEN an agent's or a skill's attachments change, the system shall leave that agent's or skill's version number unchanged.
- AC23 [US1, US2, US3, US5]: IF an agent, skill or repository belongs to another workspace, THEN the system shall answer "not found" and reveal neither its document list nor its attachments.
- AC24 [US4]: IF the attached total on an agent's Context tab, skill documents included, is over the 12,000-token project context cap applied at run time, THEN the system shall show a warning on that tab naming the documents that will be left out of the prompt.
- AC25 [US3]: The system shall show in a skill's "Project context to use" section a "Serializes as" box containing the heading `## Project context` followed by the skill's attached paths in their saved order.

## Edge cases

- EC1: An attached document is renamed, moved or deleted in the repository after it was attached — the Context tab shows it as "not found" (covered by AC21).
- EC2: The user switches the studio to another repository that lacks a path attached to the agent — the tab names the new repository and shows that path as "not found" (covered by AC8, AC21).
- EC3: A document sits under nested roots, such as `docs/specs/api.md` — its type is `specs` (covered by AC2).
- EC4: A package-level `server/INSIGHTS.md` outside any search root — listed with type `insights` (covered by AC1, AC2).
- EC5: A large monorepo with 2,000 matching files — the first 500 by path are listed with a message about the rest, and filtering still finds a document beyond the first 500 (covered by AC3).
- EC6: A document is 10,000 tokens — marked "truncated" and counted as 4,000 (covered by AC18).
- EC7: A document is attached to the agent and to a skill it uses — counted once in the agent's total (covered by AC19).
- EC8: A skill with attachments is linked to the agent but disabled — its documents are not listed as inherited (covered by AC13).
- EC9: A document contains raw HTML or a `<script>` tag — the preview shows it without running it (covered by AC5).
- EC10: The repository has not finished cloning — lists show the "not cloned yet" state (covered by AC6).
- EC11: A crafted request attaches `../../etc/passwd.md`, `/abs/path.md` or `specs/notes.txt` — rejected (covered by AC20).
- EC12: The user attaches a document from the Project Context page to an agent that already has it — it stays attached once, at its old position (covered by AC15).
- EC13: The filter text matches no document — the list is empty while the filter is set (covered by AC4).
- EC14: An agent's own documents fit the cap, but documents added by its skills take the total over 12,000 tokens — the agent tab warns and names the documents that will be left out (covered by AC24, AC19).
- EC15: A skill has no attached documents — its "Serializes as" box shows the heading only (covered by AC25).

## Non-functional requirements

- **No model call.** Listing, previewing, counting and attaching make no LLM request.
- **Size limits.** A listing shows at most 500 documents (AC3); a document counts as at most 4,000 tokens (AC18). The 12,000-token section cap applies at run time (SPEC-02-context-injection).
- **Logging.** Document text never appears in server log lines; logs carry paths, counts and sizes only.
- **Tenancy.** Every list and attachment read or write is scoped to the caller's workspace (AC23; `server/CLAUDE.md` › Non-default conventions).
- **Contract reach.** New attachment and document-list payloads are shared between server and client, so the canonical copy and the client's separate copy of the shared contracts both carry them (root `CLAUDE.md` › Rules; root `INSIGHTS.md` 2026-09-19 on drift).
- **Accessibility.** Each attach checkbox has an accessible name containing the document path; the type tag shows its name as text, never colour alone; reordering has a keyboard alternative to dragging.
- **i18n.** All new user-facing text is translatable and ships in English.

## Inputs and provenance

| fact | source | date |
|---|---|---|
| An inactive skill (off at either level) contributes nothing to a run and appears nowhere | `server/specs/skills.md:19-21`, `server/specs/skills.md:42-46` | 2026-10-03 |
| Token counter: js-tiktoken `cl100k_base`, falling back to `ceil(chars / 4)`; not the target model's tokenizer, hence "≈" | `server/src/adapters/tokenizer/index.ts:20-39` | 2026-10-03 |
| A live token-count endpoint already exists for the skill editor | `server/specs/skills.md:96` | 2026-10-03 |
| Agents and skills are workspace-wide; an agent row has no repository | `server/src/db/schema/agents.ts:8-36` | 2026-10-03 |
| Toggling a skill link does not bump a version (precedent for attachments) | `server/specs/skills.md:26-28` | 2026-10-03 |
| A repository's local copy is a shallow clone whose working tree is reset to the default branch on resync | `server/src/modules/repos/service.ts:61-63`, `server/src/adapters/git/simple-git.ts:77-88` | 2026-10-03 |
| This repository keeps insights in `INSIGHTS.md` files at the root and package roots, not in `insights/` folders | `INSIGHTS.md`, `server/INSIGHTS.md`, `client/INSIGHTS.md`, `reviewer-core/INSIGHTS.md` | 2026-10-03 |
| Agent editor tabs today: Config, Skills; skill detail tabs: Config, Preview, Stats, Versions | `client/src/app/(shell)/agents/[id]/_components/AgentEditor/constants.ts`, `client/src/app/(shell)/skills/_components/SkillsView/_components/SkillDetail/constants.ts` | 2026-10-03 |
| The sidebar has no Project Context entry; nav items are a data registry | `client/src/vendor/ui/nav.ts:21-38`, `client/INSIGHTS.md` 2026-09-22 | 2026-10-03 |
| The UI kit's markdown renderer styles only some tags; headings and lists need scoped CSS | `client/INSIGHTS.md` 2026-09-22 (`Markdown` entry) | 2026-10-03 |
| An embeddings table with `source: docs | spec` exists but is unused by this feature | `server/src/db/schema/context.ts:31-47` | 2026-10-03 |
| Project Context page: file list, Preview/Edit, "Used by 3 agents", coverage ring, "Indexed … chunks" footer, path `.devdigest/specs/` | design `images/2.png` | 2026-10-03 |
| Agent Context tab: "N of M attached", filter, drag handle, checkbox, path, folder, type tag, Preview, "≈ 317 tokens", "Injected as an untrusted block" | design `images/3.png` | 2026-10-03 |
| Skill Context tab: "Project context to use", "Any agent using this skill inherits these documents", "SERIALIZES AS ## Project specifications" | design `images/4.png` | 2026-10-03 |
| Manual selection only; reader recurses `specs/`, `docs/`, `insights/` with configurable roots; paths stored, not text; Context tab on agents, "Project context to use" on skills | design `images/6.png` (course brief) | 2026-10-03 |
| User requirements 1–3 (find all docs; attach on page and tabs; per-document tokens) | user answer (brief, translated) | 2026-10-03 |
| An attachment is a path only, resolved in the PR's repository; tabs list the active repository's documents | user answer (OQ1 = A) | 2026-10-03 |
| Documents are read from the default branch as of the last sync | user answer (OQ2 = A) | 2026-10-03 |
| Page scope: browse, filter, read-only preview, "Attach to…" listing agents and skills, "Used by N agents · M skills"; Edit, new file/folder, upload, coverage ring and "Indexed … chunks" footer out | user answer (OQ3 = A) | 2026-10-03 |
| 4,000 tokens per document (truncated, marked "truncated"); 12,000 per section; at most 500 documents per listing | user answer (OQ4 = A) | 2026-10-03 |
| Discovery: configured root folders plus every `INSIGHTS.md` file | user answer (OQ5 = A) | 2026-10-03 |
| One `## Project context` section, agent documents first, then each skill's, deduplicated; agent tab lists skill documents read-only | user answer (OQ6 = A) | 2026-10-03 |
| Changing attachments does not create a new version | user answer (OQ7 = no) | 2026-10-03 |
| Nested roots: the innermost root folder gives the type | user answer (OQ8 = innermost) | 2026-10-03 |
| Over 500 documents: the first 500 in path order; the filter searches all documents | user answer (second round, OQ1 = A) | 2026-10-03 |
| The agent tab warns when the total, skill documents included, is over the 12,000-token cap, naming the documents left out | user answer (second round, OQ2 = A) | 2026-10-03 |
| The skill tab keeps the "Serializes as" box, showing `## Project context` and the attached paths in order | user answer (second round, OQ3 = A) | 2026-10-03 |

## Untrusted inputs

| input | handling | AC |
|---|---|---|
| Attachment paths in API requests (user-controlled) | rejected unless relative, without `..`, ending in `.md` and inside a configured root or named `INSIGHTS.md` | AC20 |
| Markdown rendered in previews (repository text; may contain raw HTML or script) | rendered read-only without running scripts or raw HTML | AC5 |
| Document size (a huge file distorts totals) | counted as at most 4,000 tokens and marked "truncated" | AC18 |
| Very large repositories (thousands of matching files) | listing capped at the first 500 by path, with a message; filtering still covers all | AC3 |
| Cross-workspace ids in requests | answered as not found | AC23 |
| Document text at run time (injection, symlinks, non-UTF-8) | handled by SPEC-02-context-injection; this spec never sends document text to a model | AC10 |

## Open questions

none
