import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { PrBrief, ReviewRecord } from "@devdigest/shared";
import brief from "@messages/en/brief.json";
import prReview from "@messages/en/prReview.json";
import { ApiError } from "@/lib/api";

const h = vi.hoisted(() => ({
  brief: { data: undefined as unknown, isLoading: false },
  gen: { mutate: vi.fn(), isPending: false, error: null as unknown },
}));
vi.mock("@/lib/hooks", () => ({
  usePrBrief: () => h.brief,
  useGenerateBrief: () => h.gen,
}));

import { PrBriefBlock } from "./PrBriefBlock";

afterEach(cleanup);
beforeEach(() => {
  h.brief = { data: null, isLoading: false };
  h.gen = { mutate: vi.fn(), isPending: false, error: null };
});

const BRIEF: PrBrief = {
  summary: "<b>x</b> adds paging",
  intent: null,
  blast: null,
  risks: {
    risks: [
      {
        kind: "data",
        title: "High risk title",
        explanation: "High explanation",
        severity: "high",
        file_refs: [
          { file: "src/a.ts", start_line: 12, end_line: 18 },
          { file: "src/b.ts", start_line: 3, end_line: null },
          { file: "src/blast-only.ts", start_line: 1, end_line: null },
        ],
      },
      {
        kind: "perf",
        title: "Low risk title",
        explanation: "Low explanation",
        severity: "low",
        file_refs: [],
      },
    ],
  },
  history: null,
  review_focus: [{ file: "src/a.ts", line: 12, reason: "core change" }],
  head_sha: "sha-1",
  generated_at: "2026-10-04T00:00:00.000Z",
  missing_inputs: [],
  truncated_sources: [],
  provider: "openai",
  model: "gpt-4.1",
  tokens_in: 100,
  tokens_out: 50,
};

const REVIEW = {
  id: "r1",
  kind: "review",
  verdict: "request_changes",
  summary: "Bad",
  score: 42,
  agent_name: "Sec",
  findings: [{ severity: "CRITICAL", dismissed_at: null }],
} as unknown as ReviewRecord;

function setup(over: Partial<React.ComponentProps<typeof PrBriefBlock>> = {}) {
  const onNavigate = vi.fn();
  render(
    <NextIntlClientProvider locale="en" messages={{ brief, prReview }}>
      <PrBriefBlock
        prId="pr-1"
        headSha="sha-1"
        reviews={[]}
        diffPaths={new Set(["src/a.ts", "src/b.ts"])}
        onNavigate={onNavigate}
        {...over}
      >
        <div>cards slot</div>
      </PrBriefBlock>
    </NextIntlClientProvider>,
  );
  return { onNavigate };
}

describe("PrBriefBlock", () => {
  it("offers Generate when no brief exists; click calls mutate once; children render", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Generate brief" }));
    expect(h.gen.mutate).toHaveBeenCalledTimes(1);
    expect(screen.getByText("cards slot")).toBeInTheDocument();
    expect(screen.queryByText("PR SCORE")).not.toBeInTheDocument();
  });

  it("shows skeletons and a disabled Generate while pending", () => {
    h.gen.isPending = true;
    setup();
    expect(screen.getByRole("button", { name: /Generate brief/ })).toBeDisabled();
    expect(screen.getByLabelText("Generating brief")).toHaveAttribute("aria-busy", "true");
  });

  it("flags a stale brief and offers Refresh", () => {
    h.brief = { data: BRIEF, isLoading: false };
    setup({ headSha: "sha-2" });
    expect(screen.getByText("Out of date")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(h.gen.mutate).toHaveBeenCalledTimes(1);
  });

  it("renders risks in stored order (high first) with severity words, refs as buttons, and expands an explanation", () => {
    h.brief = { data: BRIEF, isLoading: false };
    setup();
    const heads = screen.getAllByRole("button", { expanded: false });
    expect(heads[0]).toHaveTextContent("High risk title");
    expect(heads[0]).toHaveTextContent("High");
    expect(screen.getByRole("button", { name: "src/a.ts:12-18" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "src/b.ts:3" })).toBeInTheDocument();
    expect(screen.queryByText("High explanation")).not.toBeInTheDocument();
    fireEvent.click(heads[0]!);
    expect(screen.getByText("High explanation")).toBeInTheDocument();
  });

  it("navigates from an in-diff risk ref; a ref outside the diff shows a notice and stays", () => {
    h.brief = { data: BRIEF, isLoading: false };
    const { onNavigate } = setup();
    fireEvent.click(screen.getByRole("button", { name: "src/b.ts:3" }));
    expect(onNavigate).toHaveBeenCalledWith("src/b.ts", 3);
    fireEvent.click(screen.getByRole("button", { name: "src/blast-only.ts:1" }));
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(screen.getByText("File not in this PR's diff")).toBeInTheDocument();
  });

  it("focus item is a keyboard-reachable native button that navigates", () => {
    h.brief = { data: BRIEF, isLoading: false };
    const { onNavigate } = setup();
    const btn = screen.getByRole("button", { name: /src\/a\.ts:12 — core change/ });
    btn.focus();
    expect(btn).toHaveFocus();
    expect(btn.tagName).toBe("BUTTON");
    fireEvent.click(btn);
    expect(onNavigate).toHaveBeenCalledWith("src/a.ts", 12);
  });

  it("renders the summary literally and the older-intent label", () => {
    h.brief = { data: { ...BRIEF, missing_inputs: ["intent_stale"] }, isLoading: false };
    setup();
    expect(screen.getByText("<b>x</b> adds paging")).toBeInTheDocument();
    expect(screen.getByText(/Intent \(from an older commit\)/)).toBeInTheDocument();
  });

  it("shows the failure message with Retry while the stored brief stays", () => {
    h.brief = { data: BRIEF, isLoading: false };
    h.gen.error = new ApiError("x", 502, "invalid_model_answer");
    setup();
    expect(screen.getByRole("alert")).toHaveTextContent(/answer/i);
    expect(screen.getByText("High risk title")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(h.gen.mutate).toHaveBeenCalledTimes(1);
  });

  it("shows the empty-risk line", () => {
    h.brief = { data: { ...BRIEF, risks: { risks: [] } }, isLoading: false };
    setup();
    expect(screen.getByText("No notable risks flagged.")).toBeInTheDocument();
  });

  it("shows the newest review's verdict banner", () => {
    h.brief = { data: BRIEF, isLoading: false };
    setup({ reviews: [REVIEW] });
    expect(screen.getByText("Request changes")).toBeInTheDocument();
    expect(screen.getByText("PR SCORE")).toBeInTheDocument();
  });
});
