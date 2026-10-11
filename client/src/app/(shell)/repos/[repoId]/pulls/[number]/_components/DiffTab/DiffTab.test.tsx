/**
 * DiffTab — the Files changed tab's Smart/Original toggle and role groups.
 * `buildRoleGroups`/`latestFindings` already have their own unit test
 * (helpers.test.ts); this file covers what only the mounted component can
 * show: group headers render in ROLE_ORDER with the right expand/collapse
 * state, the findings counter is an accessible name (not visible text), and
 * the two orders really render different file lists.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord, PrFile, ReviewRecord, SmartDiffResponse } from "@devdigest/shared";
import shellMessages from "@messages/en/shell.json";
import prReviewMessages from "@messages/en/prReview.json";

const usePrComments = vi.fn();
const useCreatePrComment = vi.fn();
const usePrReviews = vi.fn();
const useFindingAction = vi.fn();
vi.mock("@/lib/hooks/reviews", () => ({
  usePrComments: (prId: string | null) => usePrComments(prId),
  useCreatePrComment: (prId: string | null) => useCreatePrComment(prId),
  usePrReviews: (prId: string | null) => usePrReviews(prId),
  useFindingAction: () => useFindingAction(),
}));

const useSmartDiff = vi.fn();
vi.mock("@/lib/hooks/smart-diff", () => ({
  useSmartDiff: (prId: string | null) => useSmartDiff(prId),
}));

import { DiffTab } from "./DiffTab";

// jsdom has no scrollIntoView; FileCard calls it for a targeted file.
Element.prototype.scrollIntoView = vi.fn();

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// GitHub order deliberately does NOT follow ROLE_ORDER, so the "Original
// order" assertion below proves it renders `files` order, not the grouping.
const FILES: PrFile[] = [
  { path: ".env.example", additions: 1, deletions: 0, patch: null },
  { path: "docs/x.md", additions: 1, deletions: 0, patch: null },
  { path: "src/a.ts", additions: 1, deletions: 0, patch: null },
  { path: "pnpm-lock.yaml", additions: 1, deletions: 0, patch: null },
  { path: "src/a.test.ts", additions: 1, deletions: 0, patch: null },
  { path: "src/b.ts", additions: 1, deletions: 0, patch: null },
];

const SMART_DIFF: SmartDiffResponse = {
  groups: [
    {
      role: "core",
      files: [
        { path: "src/a.ts", additions: 1, deletions: 0, finding_lines: [] },
        { path: "src/b.ts", additions: 1, deletions: 0, finding_lines: [] },
      ],
    },
    { role: "tests", files: [{ path: "src/a.test.ts", additions: 1, deletions: 0, finding_lines: [] }] },
    { role: "wiring", files: [{ path: ".env.example", additions: 1, deletions: 0, finding_lines: [] }] },
    { role: "docs", files: [{ path: "docs/x.md", additions: 1, deletions: 0, finding_lines: [] }] },
    { role: "boilerplate", files: [{ path: "pnpm-lock.yaml", additions: 1, deletions: 0, finding_lines: [] }] },
  ],
  split_suggestion: { too_big: false, total_lines: 6, proposed_splits: [] },
};

function finding(over: Partial<FindingRecord> & { id: string; file: string }): FindingRecord {
  return {
    severity: "WARNING",
    category: "bug",
    title: "t",
    start_line: 1,
    end_line: 1,
    rationale: "r",
    confidence: 0.5,
    review_id: "rev1",
    accepted_at: null,
    dismissed_at: null,
    ...over,
  } as FindingRecord;
}

function review(over: Partial<ReviewRecord> & { id: string }): ReviewRecord {
  return {
    pr_id: "pr1",
    agent_id: "gen",
    run_id: null,
    kind: "review",
    verdict: null,
    summary: null,
    score: null,
    model: null,
    created_at: "2026-01-01T00:00:00Z",
    findings: [],
    ...over,
  } as ReviewRecord;
}

function renderDiffTab(props: { target?: { path: string; line: number | null } | null; files?: PrFile[] } = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ shell: shellMessages, prReview: prReviewMessages }}>
      <DiffTab prId="pr1" files={props.files ?? FILES} target={props.target} />
    </NextIntlClientProvider>,
  );
}

function stubBaseHooks() {
  usePrComments.mockReturnValue({ data: [] });
  useCreatePrComment.mockReturnValue({ isPending: false, mutateAsync: vi.fn() });
  useFindingAction.mockReturnValue({ isPending: false, mutate: vi.fn() });
  useSmartDiff.mockReturnValue({ data: SMART_DIFF });
}

describe("DiffTab — Smart/Original order and role groups", () => {
  it("renders groups in ROLE_ORDER with the right collapsed state, an accessible findings count, and toggles to/from Original order", () => {
    stubBaseHooks();
    usePrReviews.mockReturnValue({
      data: [
        review({
          id: "rev1",
          findings: [finding({ id: "f1", file: "src/a.ts", start_line: 2, dismissed_at: null })],
        }),
      ],
    });

    renderDiffTab();

    // Group header buttons appear in ROLE_ORDER; their accessible name also
    // pins the collapsed-by-default state (docs, boilerplate start collapsed).
    const groupButtons = screen.getAllByRole("button", { name: /group/i });
    expect(groupButtons.map((b) => b.getAttribute("aria-label"))).toEqual([
      "Collapse Core group",
      "Collapse Tests group",
      "Collapse Wiring group",
      "Expand Docs group",
      "Expand Boilerplate group",
    ]);
    expect(groupButtons.map((b) => b.getAttribute("aria-expanded"))).toEqual([
      "true",
      "true",
      "true",
      "false",
      "false",
    ]);

    // The group findings counter is read via its accessible name, not the
    // bare "1" it displays next to the dot.
    expect(screen.getByRole("img", { name: "1 file with findings" })).toBeInTheDocument();

    // Switching to Original order hides the group headers and renders the
    // flat file list in GitHub (prop) order, not grouped/reordered.
    fireEvent.click(screen.getByRole("button", { name: "Original order" }));
    expect(screen.queryByRole("button", { name: /group/i })).not.toBeInTheDocument();
    const paths = FILES.map((f) => f.path);
    const pathNodes = screen.getAllByText((_, el) => paths.includes(el?.textContent ?? ""));
    expect(pathNodes.map((n) => n.textContent)).toEqual(paths);

    // Switching back restores the role groups.
    fireEvent.click(screen.getByRole("button", { name: "Smart order" }));
    expect(screen.getAllByRole("button", { name: /group/i })).toHaveLength(5);
  });

  it("shows 'Review not run yet' instead of a findings count when no review has run", () => {
    stubBaseHooks();
    usePrReviews.mockReturnValue({ data: [] });

    renderDiffTab();

    expect(screen.getAllByText("Review not run yet")).toHaveLength(5);
    expect(screen.queryByRole("img", { name: /files? with findings/i })).not.toBeInTheDocument();
  });
});

describe("DiffTab — target from the PR Brief", () => {
  const DOC_PATCH = "@@ -1,1 +1,2 @@\n context\n+added line";
  const filesWithDocPatch = FILES.map((f) => (f.path === "docs/x.md" ? { ...f, patch: DOC_PATCH } : f));

  it("expands the targeted file's collapsed role group and marks the targeted row", () => {
    stubBaseHooks();
    usePrReviews.mockReturnValue({ data: [] });

    renderDiffTab({ files: filesWithDocPatch, target: { path: "docs/x.md", line: 2 } });

    expect(screen.getByRole("button", { name: "Collapse Docs group" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Expand Boilerplate group" })).toBeInTheDocument();
    expect(document.querySelector('[aria-current="location"]')).not.toBeNull();
  });

  it("turns inline findings and comments on when a target exists, and the user's toggle still wins", () => {
    stubBaseHooks();
    // A comment makes the toggle visible while no finding is open: without a target the default is "hidden".
    usePrComments.mockReturnValue({ data: [{ id: "c1" }] });
    usePrReviews.mockReturnValue({ data: [] });

    renderDiffTab({ files: filesWithDocPatch, target: { path: "docs/x.md", line: 2 } });

    fireEvent.click(screen.getByRole("button", { name: "Hide comments & findings" }));
    expect(screen.getByRole("button", { name: "Show comments & findings" })).toBeInTheDocument();
  });

  it("shows a notice for a file that is not in the diff and still renders the groups", () => {
    stubBaseHooks();
    usePrReviews.mockReturnValue({ data: [] });

    renderDiffTab({ target: { path: "src/nope.ts", line: 3 } });

    expect(screen.getByRole("status")).toHaveTextContent("src/nope.ts is not in this pull request's changed files.");
    expect(screen.getAllByRole("button", { name: /group/i })).toHaveLength(5);
  });
});
