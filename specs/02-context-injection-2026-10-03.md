# Spec: Project Context — run-time injection and trace
Spec ID: SPEC-02-context-injection
Status: approved
Supersedes: none
Packages: server, reviewer-core, client
Depends on: SPEC-01-project-context

## Problem and user

The people hurt are **developers whose pull requests are reviewed** and
**anyone who inspects a run**. SPEC-01-project-context lets an author attach
markdown documents (specs, docs, insights) to agents and skills. Those
attachments are worthless until a run actually reads the documents and gives
them to the reviewer — and until a user can see, in the run trace, exactly
which documents were read, how many tokens each added, and the full text that
was sent. Today the prompt's `## Project context` slot is never filled and
every trace records `specs_read: []`, so nobody can tell whether a reviewer
knew a project rule.

Why it matters: this is the half of the Project Context feature that changes
the reviewer's behaviour and makes that change verifiable. Repository text is
also a prompt-injection vector, exactly like the diff, so it must reach the
model only as delimited, untrusted data.

The demo check from the course brief (manual, because it depends on model
output): attach a document stating "module `api/` does not import `db/`
directly", open a PR that breaks it, and confirm the reviewer cites that
document.

## Goals / Non-goals

Goals:

- Read the attached documents when a run starts, from the repository of the PR
  under review — because the attachment stores only a path (SPEC-01) and the
  document can change after it was attached.
- Give the documents to the reviewer in one `## Project context` section, each
  delimited as untrusted data and labelled with its path — so the model can cite
  the rule by its document, and the document cannot steer the review.
- Keep the prompt bounded — because every attached token is paid on every
  prompt of every run.
- Record in the trace the documents read, their token counts and the full text —
  because the feature is only useful if a user can verify what the reviewer saw.

Non-goals:

- Choosing, listing or attaching documents — that is SPEC-01-project-context.
- Automatic selection of documents from the PR content — a separate feature
  (course brief).
- Reading documents from the PR's head or base commit — the user chose the
  default branch (OQ2 of SPEC-01's first draft), so a PR cannot weaken the rule
  it is judged by.
- Any change to the findings contract, grounding, score or verdict — documents
  only add context; a finding citing a document is still grounded on the diff.
- How the files are read, how the prompt is assembled or how the trace record is
  shaped — that is for the implementation planner.

## User stories

- US1: As a developer whose PR is reviewed, I want the attached documents read from the repository at run time and given to the reviewer as labelled, untrusted data, so that a finding can cite the project rule my change breaks and the documents cannot steer the review.
- US2: As an agent author, I want project context kept within a fixed token budget, so that attaching documents cannot make a run unexpectedly expensive or overflow the model's context.
- US3: As a user inspecting a run, I want the trace to list the documents read with their token counts and show the full text that was added, so that I can verify what the reviewer actually saw.

## Acceptance criteria (EARS)

- AC1 [US1]: WHEN a run starts, the system shall read the text of every document attached to the agent and to its active skills from the local copy of the repository the PR belongs to, as that copy stood on its default branch at the last sync, using the attachment list as it stood when the run started.
- AC2 [US1]: WHILE a skill is active for an agent (linked to it and enabled at both levels), the system shall include that skill's attached documents in the agent's runs.
- AC3 [US1]: The system shall order the documents of a run as the agent's own documents in the agent's attachment order, followed by each active skill's documents, skills taken in the agent's skill order and each skill's documents in that skill's attachment order.
- AC4 [US1]: WHEN the same document is attached more than once among an agent and its active skills, the system shall put its text into the prompt once, at its first position in the order of AC3.
- AC5 [US1]: The system shall put the documents read for a run into one prompt section headed `## Project context`, each document inside its own untrusted-data delimiter that carries the document's repository-relative path, placed after the repo skeleton and before the callers of changed symbols.
- AC6 [US1]: IF a document's text contains the closing marker of the untrusted-data delimiter, THEN the system shall neutralise that marker so the document cannot end its own block early.
- AC7 [US1]: IF no attached document yields text for a run, THEN the system shall send a prompt byte-identical to the prompt the same run would get without this feature.
- AC8 [US1]: IF an attached document is missing from the repository, unreadable, not valid UTF-8, empty, or resolves to a location outside the repository's local copy, THEN the system shall leave that document out, write one Live Log line naming its path and the reason, and complete the run.
- AC9 [US2]: IF a document is longer than 4,000 tokens, THEN the system shall add only its first 4,000 tokens to the prompt and record the document as truncated in the trace.
- AC10 [US2]: IF adding a document would take the project context section over 12,000 tokens, THEN the system shall leave out that document and every later one, writing one Live Log line per document left out that names its path.
- AC11 [US3]: WHEN a run that added at least one document to its prompt is saved, the system shall record in its trace, for each document added, its repository-relative path, its token count and whether it was truncated, in prompt order.
- AC12 [US3]: The system shall show in the run trace's Configuration card, under "Specs read", every document recorded for the run with its path, its token count and a "truncated" mark where it applies, and "none" when the run recorded no document.
- AC13 [US3]: WHEN a run's prompt contained a project context section, the system shall show in the trace's Prompt assembly card a section titled "Project context — attached specs (untrusted)" that expands to the full text sent and offers a copy control.
- AC14 [US3]: IF a trace was saved before this feature existed, THEN the system shall render it with "Specs read: none" and without a project context section, as it renders today.
- AC15 [US3]: IF a run belongs to another workspace, THEN the system shall answer "not found" and reveal none of its documents.

## Edge cases

- EC1: The PR is in a repository that has no file at an attached path (the agent is used across repositories) — that document is left out with a Live Log line (covered by AC8).
- EC2: An attached document was renamed, moved or deleted on the default branch — left out with a Live Log line (covered by AC8).
- EC3: An attached path is a symlink whose target is outside the repository's local copy — not read (covered by AC8).
- EC4: A document is empty or whitespace only — left out; if it was the only one, the prompt is unchanged (covered by AC8, AC7).
- EC5: A document is not valid UTF-8 (binary file with an `.md` name) — left out with a reason (covered by AC8).
- EC6: A document contains text written to look like instructions, or a fake closing delimiter — it stays inside its block as data (covered by AC5, AC6).
- EC7: A document is attached to the agent and to a skill it uses — its text appears once, at the agent's position (covered by AC4).
- EC8: A skill with attached documents is linked to the agent but disabled for it, or disabled globally — it contributes no documents (covered by AC2).
- EC9: The author edits attachments while a run is in progress — the running review keeps the list it started with (covered by AC1).
- EC10: The repository has no local copy yet — no document can be read; the run reviews without project context and completes (covered by AC8, AC7).
- EC11: A PR edits an attached document — the run still reads the default-branch version, so the PR cannot change the rule it is judged by (covered by AC1).
- EC12: One document alone is 10,000 tokens — it is cut to 4,000 and marked truncated (covered by AC9).
- EC13: The first documents fill the 12,000-token section — the rest are left out, each with a log line (covered by AC10).
- EC14: The agent's review strategy splits the diff into several model calls — every call carries the same project context section, so the per-document token count is per prompt (covered by AC5, AC11).
- EC15: A trace saved before this feature is opened — it renders as today (covered by AC14).

## Non-functional requirements

- **No extra model call.** Adding project context makes no LLM request of its own (course brief); its only cost is the prompt tokens it adds, at most 12,000 per prompt (AC10).
- **Degradation.** Project context is best-effort enrichment, like repo-intel, intent and skills: no failure to read or render documents fails a run (`server/specs/review-flow.md` › What one run does, step 1).
- **Token measurement.** Token counts use the same counter as the rest of the prompt-section measurement, so the trace and the SPEC-01 tabs agree for the same text.
- **Logging.** Document text never reaches the server's content-free prompt log or any warn or error log line; logs carry paths, counts and sizes only (`server/specs/review-flow.md` invariant 6).
- **Contract reach.** The run-trace contract gains per-document records; the canonical copy and the client's separate copy of the shared contracts both need the change, and traces already stored must still parse (root `CLAUDE.md` › Rules; root `INSIGHTS.md` 2026-09-19).
- **Engine purity.** The review engine still does no file or repository access; documents arrive as resolved text (`reviewer-core/specs/review-contract.md` › Purity rules).
- **Tenancy.** Trace reads stay scoped to the caller's workspace (AC15).
- **i18n.** New trace labels are translatable and ship in English.

## Inputs and provenance

| fact | source | date |
|---|---|---|
| The prompt already has a `## Project context` section fed by a `specs` list, rendered after the repo skeleton and before callers, omitted when empty | `reviewer-core/src/prompt.ts:238-241`, `reviewer-core/src/prompt.ts:268` | 2026-10-03 |
| Each spec entry is wrapped as `<untrusted source="spec-<i>">` — the label is an index, not the path | `reviewer-core/src/prompt.ts:240` | 2026-10-03 |
| `wrapUntrusted` neutralises a literal `</untrusted>` inside content | `reviewer-core/src/prompt.ts:30-34` | 2026-10-03 |
| Every optional prompt slot is omit-when-empty; unused → byte-identical prompt | `reviewer-core/specs/review-contract.md:31-33` | 2026-10-03 |
| The engine does no filesystem access; I/O belongs to the server caller | `reviewer-core/specs/review-contract.md:128-139` | 2026-10-03 |
| In map-reduce every chunk prompt is assembled from the same parts, specs included | `reviewer-core/src/review/run.ts:165-183` | 2026-10-03 |
| The run executor never fills specs: `specs_read: []` on success and failure | `server/src/modules/reviews/run-executor.ts:399`, `server/src/modules/reviews/run-executor.ts:601` | 2026-10-03 |
| Skill blocks are built only for active skills and token-counted with the server tokenizer | `server/src/modules/reviews/run-executor.ts:448-471` | 2026-10-03 |
| An inactive skill contributes nothing to a run and appears nowhere | `server/specs/skills.md:19-21`, `server/specs/skills.md:42-46` | 2026-10-03 |
| The trace contract has `prompt_assembly.specs` (text) and `specs_read` (strings only, no token count) | `server/src/vendor/shared/contracts/trace.ts:55`, `server/src/vendor/shared/contracts/trace.ts:104` | 2026-10-03 |
| The client copy of the trace contract has the same two fields | `client/src/vendor/shared/contracts/trace.ts:55`, `client/src/vendor/shared/contracts/trace.ts:103` | 2026-10-03 |
| The trace drawer renders "Specs read" (paths only) and a block labelled "Project context (dynamic)" when `specs` is set | `client/src/app/(shell)/repos/[repoId]/pulls/[number]/_components/RunTraceDrawer/_components/TraceBody/TraceBody.tsx:50-62`, `TraceBody.tsx:101-103`, `client/messages/en/runs.json:51` | 2026-10-03 |
| A repository's local copy is a shallow clone whose working tree is reset to the default branch on resync | `server/src/modules/repos/service.ts:61-63`, `server/src/adapters/git/simple-git.ts:77-88` | 2026-10-03 |
| Enrichment never fails a run | `server/specs/review-flow.md:77-82` | 2026-10-03 |
| Prompt log is content-free (no spec or skill body) | `server/specs/review-flow.md:117-124` | 2026-10-03 |
| Trace: "Specs read" in Configuration; "Project context — attached specs (untrusted)" in Prompt assembly with copy and expand | design `images/5.png` | 2026-10-03 |
| Paths stored, read before the run, untrusted with delimiters and guard; trace lists docs with token sizes; no extra LLM call; verification by an `api/`→`db/` invariant | design `images/6.png` (course brief) | 2026-10-03 |
| An attachment is a path resolved in the PR's repository; a missing file is skipped with a log line | user answer (OQ1 = A) | 2026-10-03 |
| Documents are read from the default branch as of the last sync | user answer (OQ2 = A) | 2026-10-03 |
| 4,000 tokens per document (truncated, marked "truncated"); 12,000 per section (the rest skipped with a log line) | user answer (OQ4 = A) | 2026-10-03 |
| One `## Project context` section: agent's documents first, then each skill's, deduplicated | user answer (OQ6 = A) | 2026-10-03 |

## Untrusted inputs

| input | handling | AC |
|---|---|---|
| Document text read from the repository (anyone with push access can write it) | placed only inside an untrusted-data delimiter labelled with its path; the system guard treats it as data | AC5 |
| A delimiter-closing marker inside document text | neutralised so the block cannot end early | AC6 |
| A PR that edits an attached document to weaken it | the run reads the default-branch version, not the PR's | AC1 |
| Symlinks and paths that resolve outside the local copy at read time | not read; logged with a reason | AC8 |
| Non-UTF-8 or empty files | left out; logged with a reason | AC8 |
| Oversized documents | cut at 4,000 tokens per document | AC9 |
| Many or large documents together | section capped at 12,000 tokens | AC10 |
| Cross-workspace run ids | answered as not found | AC15 |

## Open questions

none
