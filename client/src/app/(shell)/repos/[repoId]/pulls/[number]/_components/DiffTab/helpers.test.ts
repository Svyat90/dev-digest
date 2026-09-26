import { describe, it, expect } from "vitest";
import type { FindingRecord, PrFile, ReviewRecord, SmartDiffResponse } from "@devdigest/shared";
import { buildRoleGroups, findingsByPath, latestFindings } from "./helpers";

const file = (path: string): PrFile => ({ path, additions: 1, deletions: 0, patch: null });

const finding = (over: Partial<FindingRecord> & { id: string; file: string }): FindingRecord =>
  ({
    severity: "WARNING",
    category: "bug",
    title: "t",
    start_line: 1,
    end_line: 1,
    rationale: "r",
    confidence: 0.5,
    review_id: "rev",
    accepted_at: null,
    dismissed_at: null,
    ...over,
  }) as FindingRecord;

const review = (over: Partial<ReviewRecord> & { id: string }): ReviewRecord =>
  ({
    pr_id: "pr1",
    agent_id: null,
    run_id: null,
    kind: "review",
    verdict: null,
    summary: null,
    score: null,
    model: null,
    created_at: "2026-01-01T00:00:00Z",
    findings: [],
    ...over,
  }) as ReviewRecord;

describe("buildRoleGroups", () => {
  it("orders groups as the response lists them, keeps files in GitHub order, and counts files not findings", () => {
    const coreA = file("src/a.ts");
    const coreB = file("src/b.ts");
    const testsA = file("src/a.test.ts");
    const wiringA = file(".env.example");
    const docsA = file("docs/x.md");
    const boilerplateA = file("pnpm-lock.yaml");

    // GitHub order: `b` before `a` inside `core`, and roles interleaved.
    const files = [coreB, testsA, coreA, wiringA, docsA, boilerplateA];

    const smartDiff: SmartDiffResponse = {
      groups: [
        {
          role: "core",
          // Response order is deliberately reversed vs. GitHub order, so the
          // assertion below proves `files` wins, not the response's own order.
          files: [
            { path: coreA.path, additions: 1, deletions: 0, finding_lines: [] },
            { path: coreB.path, additions: 1, deletions: 0, finding_lines: [] },
          ],
        },
        { role: "tests", files: [{ path: testsA.path, additions: 1, deletions: 0, finding_lines: [] }] },
        { role: "wiring", files: [{ path: wiringA.path, additions: 1, deletions: 0, finding_lines: [] }] },
        { role: "docs", files: [{ path: docsA.path, additions: 1, deletions: 0, finding_lines: [] }] },
        {
          role: "boilerplate",
          files: [{ path: boilerplateA.path, additions: 1, deletions: 0, finding_lines: [] }],
        },
      ],
      split_suggestion: { too_big: false, total_lines: 6, proposed_splits: [] },
    };

    const byPath = findingsByPath([
      finding({ id: "f1", file: coreA.path }),
      finding({ id: "f2", file: coreA.path }), // two findings, same file
    ]);

    const groups = buildRoleGroups(smartDiff, files, byPath);

    expect(groups.map((g) => g.role)).toEqual(["core", "tests", "wiring", "docs", "boilerplate"]);
    expect(groups[0]!.files.map((f) => f.path)).toEqual([coreB.path, coreA.path]); // GitHub order
    expect(groups[0]!.filesWithFindings).toBe(1); // two findings in one file count once
  });

  it("does not count a file whose only findings are dismissed, and sends an unknown path to core", () => {
    const known = file("src/a.ts");
    const unknown = file("src/new.ts"); // not in the smart-diff response (refresh race)
    const files = [known, unknown];

    const smartDiff: SmartDiffResponse = {
      groups: [{ role: "core", files: [{ path: known.path, additions: 1, deletions: 0, finding_lines: [] }] }],
      split_suggestion: { too_big: false, total_lines: 2, proposed_splits: [] },
    };

    const byPath = findingsByPath([
      finding({ id: "f1", file: known.path, dismissed_at: "2026-01-02T00:00:00Z" }),
    ]);

    const groups = buildRoleGroups(smartDiff, files, byPath);

    expect(groups).toHaveLength(1);
    expect(groups[0]!.role).toBe("core");
    expect(groups[0]!.files.map((f) => f.path)).toEqual([known.path, unknown.path]);
    expect(groups[0]!.filesWithFindings).toBe(0);
  });
});

describe("latestFindings", () => {
  it("drops an agent's older review and any 'summary' review", () => {
    const oldReview = review({
      id: "old",
      agent_id: "gen",
      created_at: "2026-01-01T00:00:00Z",
      findings: [finding({ id: "old-f", file: "a.ts" })],
    });
    const newReview = review({
      id: "new",
      agent_id: "gen",
      created_at: "2026-01-02T00:00:00Z",
      findings: [finding({ id: "new-f", file: "a.ts" })],
    });
    const summaryReview = review({
      id: "sum",
      kind: "summary",
      agent_id: "gen2",
      created_at: "2026-01-03T00:00:00Z",
      findings: [finding({ id: "sum-f", file: "a.ts" })],
    });

    const findings = latestFindings([oldReview, newReview, summaryReview]);

    expect(findings.map((f) => f.id)).toEqual(["new-f"]);
  });
});
