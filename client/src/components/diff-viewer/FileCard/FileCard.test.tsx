import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, within, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord } from "@devdigest/shared";
import type { PrFile } from "@/lib/types";
import type { DiffCommentApi } from "../comments";
import type { DiffFindingApi } from "../findings";
import shellMessages from "@messages/en/shell.json";
import prReviewMessages from "@messages/en/prReview.json";
import { FileCard } from "./FileCard";

afterEach(cleanup);

// Two hunks: the first adds a line at RIGHT:2 (on-patch), the second is far
// enough away (RIGHT:21/22) that a finding on line 999 has no rendered line.
const PATCH = [
  "@@ -1,2 +1,3 @@",
  " context1",
  "+addedLine",
  "@@ -20,2 +21,2 @@",
  " context2",
  " context3",
].join("\n");

const FILE: PrFile = {
  path: "src/a.ts",
  additions: 1,
  deletions: 0,
  patch: PATCH,
};

function makeFinding(over: Partial<FindingRecord> & { id: string }): FindingRecord {
  return {
    severity: "WARNING",
    category: "bug",
    title: "A finding",
    file: FILE.path,
    start_line: 2,
    end_line: 2,
    rationale: "Explanation of the issue.",
    confidence: 0.8,
    review_id: "rev-1",
    accepted_at: null,
    dismissed_at: null,
    ...over,
  };
}

function baseCommenting(showComments: boolean): DiffCommentApi {
  return {
    comments: [],
    canComment: false,
    showComments,
    posting: false,
    onSubmit: vi.fn(),
  };
}

function baseFindingApi(findings: FindingRecord[], onAction = vi.fn()): DiffFindingApi {
  return { findings, onAction, pending: false };
}

function renderFileCard(props: { commenting?: DiffCommentApi; findings?: DiffFindingApi } = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ shell: shellMessages, prReview: prReviewMessages }}>
      <FileCard file={FILE} {...props} />
    </NextIntlClientProvider>,
  );
}

describe("FileCard findings (showComments on)", () => {
  it("shows the dot, renders the on-patch finding with its severity label, fires Accept, and renders the off-patch finding under the off-patch title", () => {
    const onAction = vi.fn();
    const onPatch = makeFinding({
      id: "on-patch",
      severity: "CRITICAL",
      title: "Hardcoded secret",
      rationale: "A secret is committed in source.",
      start_line: 2,
      end_line: 2,
    });
    const offPatch = makeFinding({
      id: "off-patch",
      title: "Stale finding",
      start_line: 999,
      end_line: 999,
    });

    renderFileCard({
      commenting: baseCommenting(true),
      findings: baseFindingApi([onPatch, offPatch], onAction),
    });

    // The file dot is visible via its accessible name.
    expect(
      screen.getByRole("img", { name: "This file has review findings" }),
    ).toBeInTheDocument();

    // The on-patch finding renders inline: title, worded severity label, rationale.
    expect(screen.getByText("Hardcoded secret")).toBeInTheDocument();
    expect(screen.getByText("blocker")).toBeInTheDocument();
    expect(screen.getByText("A secret is committed in source.")).toBeInTheDocument();

    // Accepting the on-patch finding calls onAction with that finding.
    const onPatchCard = screen.getByText("Hardcoded secret").closest('[data-finding-id="on-patch"]');
    expect(onPatchCard).not.toBeNull();
    fireEvent.click(within(onPatchCard as HTMLElement).getByRole("button", { name: "Accept" }));
    expect(onAction).toHaveBeenCalledWith(onPatch, "accept");

    // The off-patch finding renders under the off-patch title, not inline.
    expect(screen.getByText("1 finding outside the changed lines")).toBeInTheDocument();
    expect(screen.getByText("Stale finding")).toBeInTheDocument();
  });
});

describe("FileCard findings (edges)", () => {
  it("keeps the dot but hides finding titles when showComments is off", () => {
    const onPatch = makeFinding({ id: "on-patch", title: "Hardcoded secret" });

    renderFileCard({
      commenting: baseCommenting(false),
      findings: baseFindingApi([onPatch]),
    });

    expect(
      screen.getByRole("img", { name: "This file has review findings" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Hardcoded secret")).not.toBeInTheDocument();
  });

  it("hides the dot when the only finding is dismissed", () => {
    const dismissedOnly = makeFinding({
      id: "dismissed",
      title: "Old, dismissed finding",
      dismissed_at: "2026-01-01T00:00:00Z",
    });

    renderFileCard({
      commenting: baseCommenting(true),
      findings: baseFindingApi([dismissedOnly]),
    });

    expect(
      screen.queryByRole("img", { name: "This file has review findings" }),
    ).not.toBeInTheDocument();
  });
});
