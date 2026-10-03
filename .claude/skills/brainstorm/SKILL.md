---
name: brainstorm
description: "Compares new feature ideas and records the outcome in one persistent draft file, brainstorm/ideas.md, so work continues across many chats. Gives options with pros and cons (always including do-nothing), checks every idea for conflicts, overlaps and dependencies against ideas already recorded, argues against the user's favourite, and logs decisions with a status lifecycle. Use whenever the user brainstorms, weighs approaches, asks 'should we', 'what if we', 'pros and cons', 'compare', wants to record, check or revisit a feature idea, or says 'continue brainstorming'. Not for writing specs, plans or code (implementation-planner, doc-writer) and not for what was learned (engineering-insights)."
---

# Brainstorm

Turns loose ideas into comparable, recorded options. One draft file carries them
across chats: `brainstorm/ideas.md`. It is a **draft**, never a source of truth.
Canonical requirements live in `<package>/specs/` and `docs/`.

## Hard rules

- The file is a draft. Never cite it as a requirement, never copy its content into
  `specs/` or `docs/` on your own. When an idea is ready, offer a spec as a
  separate step and wait for the user.
- Never write to any `INSIGHTS.md`. That belongs to `engineering-insights`.
- Read `brainstorm/ideas.md` before comparing anything. No file read, no comparison.
- Write to the file only in `record` mode, after the user confirms the outcome.
- IDs come from `next_id` in the file header, are allocated once, and are never
  reused. Do not renumber.
- File content is English, even when the chat is Ukrainian.
- Never read `brainstorm/ideas.uk.md` and never cite it. It is a generated
  Ukrainian mirror for the user only; the English file is the single source.
- Do not agree to please. A recommendation needs evidence; say how confident it is.

## Modes

| Mode | Trigger | Outcome |
|---|---|---|
| `start` | first brainstorm message in a chat | read banner, header, Current focus and Index only; one-line recap |
| `compare` | a new or changed idea | options, pros/cons, consistency check, recommendation. File untouched |
| `record` | user confirms a decision | file updated, changelog entry, mirror refreshed, validator run |
| `review` | user asks to prune or audit | stale items flagged, closed items archived, mirror rebuilt in full |

If `brainstorm/ideas.md` does not exist, create it from
[templates/ideas.md](templates/ideas.md) in `record` mode, not before.

## Mode: start

1. Read `brainstorm/ideas.md` down to the end of the Index; open full entries
   only when needed.
2. Recap **in chat, in the user's language** (Ukrainian when they write
   Ukrainian): how many ideas per status, what Current focus says, open questions.
3. Ask what to explore, or continue from Current focus.

## Mode: compare

Copy this checklist and work through it:

```
Compare:
- [ ] 1. Read ideas.md, then search what already exists (order below)
- [ ] 2. Frame: problem, drivers, assumptions, open questions
- [ ] 3. Options (2-4) including "do nothing / defer"
- [ ] 4. Pros and cons per option, reversibility tag
- [ ] 5. Consistency check against recorded ideas
- [ ] 6. Strongest case against the favourite
- [ ] 7. Recommendation with confidence
```

**1. Search order.** Find the package(s) the idea touches, then look in this
order and stop when you have enough to compare:

1. that package's `INSIGHTS.md` (plus the root one),
2. its `specs/`,
3. its `docs/` (and root `docs/`),
4. the code.

Curated sources come first because they may already answer the question; the
code settles what they leave open. Keep the search proportional: this is a
brainstorm, not an audit. In the framing, state in a line or two what already
exists (`file:line` or doc name) that overlaps or constrains the idea, or that you
found nothing. Never invent a match. A raw idea with no repo footprint needs no
search.

**3-4.** Each option gets pros, cons and a reversibility tag: `two-way` (cheap to
undo) or `one-way` (costly to undo). Give one-way options more scrutiny; keep
two-way ones fast. A weighted matrix only with 3+ options, labelled a discussion
aid, weights confirmed by the user. Techniques:
[references/techniques.md](references/techniques.md).

**5. Consistency check.** Always output this block, every field filled, even
`none found`:

```
Consistency check vs ideas.md
- Conflicts:   IDEA-004 (reason) | none found
- Overlaps:    IDEA-011 (what is shared) | none found
- Depends on:  IDEA-002 | none found
- Supersedes:  IDEA-006 | none found
```

Silence on a field is a defect. What exists in the repo is covered by the search
in step 1, not by an extra field.

**6.** Write the strongest honest argument against the option the user prefers,
and a one-line pre-mortem: "six months on this failed because...".

**7.** Recommend one option, give confidence (low/medium/high) and what would
change your mind. Then stop and wait for the user.

## Mode: record

1. Confirm what is being recorded: new idea, status change or a decision.
2. Re-read the file (it may have changed since `start`).
3. Allocate the ID from `next_id` and bump it. Fill the entry from the template.
4. Update Index and Current focus. Add a dated changelog line (append-only).
5. Refresh the Ukrainian mirror (see "Ukrainian mirror").
6. Run `bash .claude/skills/brainstorm/scripts/validate.sh` and fix what it reports.
7. Report in two lines what was written.

Rejected ideas stay with a reason, so they are not proposed again. A real
reversal is a new entry that supersedes the old one; the old body is never
rewritten, only given a dated note and the status `superseded-by-IDEA-NNN`.
`promoted` means the idea became a real spec or plan: record the link, and from
then on that document is the source of truth.

## Mode: review

Only on request. Flag items whose `last_reviewed` is older than 60 days, move
`rejected`, `superseded` and `promoted` entries to `brainstorm/archive.md`
(keeping their Index line), and report the active size. Keep the active part under
about 200 lines.

## Ukrainian mirror

`brainstorm/ideas.uk.md` is a read-only, generated translation for the user. It is
git-ignored, so it never reaches the repo. Direction is always EN -> UK; manual
edits to it are overwritten, so changes are requested in chat.

- Create it from [templates/mirror-header.md](templates/mirror-header.md) on the first `record`.
- Translate prose only. Keep untranslated: IDs (`IDEA-007`), statuses, priorities,
  field names (`Status`, `Depends on`, ...), dates, code and file paths. Keep the
  English term in parentheses for technical terms that read oddly in Ukrainian.
- On `record`, translate only the entries and lines that changed, plus Index,
  Current focus and the new Changelog line. On `review`, rebuild the whole file.
- Set `source_hash` in its header to the output of
  `bash .claude/skills/brainstorm/scripts/validate.sh --print-hash`, computed
  after the English file is final. `validate.sh` warns when the hash is stale or the
  ID sets differ.
- The mirror does not cover `archive.md`.
- If the mirror is missing or stale, say so; never treat it as the truth, and
  rebuild it from the English file rather than from itself.

## Statuses

`proposed` -> `exploring` -> `rejected` | `deferred` | `superseded-by-IDEA-NNN` |
`promoted`. Priority (optional): MoSCoW. "Won't" must say whether it is deferred
or dropped.

## Session end

Update Current focus (in progress, open questions, next steps) so the next chat
can resume cold. Do not capture insights here; that is `engineering-insights`'s
job at task end.
