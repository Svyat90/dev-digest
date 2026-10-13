import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { AgentEvalCaseListItem, AgentEvalRunSummary } from "@devdigest/shared";
import evalMessages from "@messages/en/eval.json";
import commonMessages from "@messages/en/common.json";

let cases: AgentEvalCaseListItem[] = [];
let runs: AgentEvalRunSummary[] = [];
const startMutate = vi.fn();
const deleteMutate = vi.fn();

vi.mock("@/lib/hooks/evals", () => ({
  useAgentEvalCases: () => ({ data: cases, isLoading: false }),
  useAgentEvalRuns: () => ({ data: runs, isLoading: false }),
  useStartEvalRun: () => ({ mutate: startMutate, isPending: false }),
  useDeleteEvalCase: () => ({ mutate: deleteMutate, isPending: false }),
}));

import { EvalsTab } from "./EvalsTab";

const mkCase = (id: string, name: string, over: Partial<AgentEvalCaseListItem> = {}): AgentEvalCaseListItem => ({
  id,
  agent_id: "ag1",
  name,
  revision_id: `rev-${id}`,
  revision: 1,
  expectation_type: "must_find",
  expectation: { file: "src/a.ts", start_line: 3, end_line: 9 },
  input_file: "src/a.ts",
  input_meta: { pr_title: "t", pr_description: "" },
  provenance: {
    finding_id: "f1",
    review_id: "rv1",
    pr_id: "pr1",
    pr_number: 7,
    repo_id: "r1",
    repo_full_name: "acme/app",
    decision: "accepted",
    decided_at: "2026-10-12T10:00:00.000Z",
    agent_version: 1,
    severity: "WARNING",
    category: "bug",
    title: "x",
  },
  created_at: "2026-10-12T10:00:00.000Z",
  latest_result: null,
  ...over,
});

const mkRun = (id: string, over: Partial<AgentEvalRunSummary> = {}): AgentEvalRunSummary => ({
  id,
  agent_id: "ag1",
  status: "completed",
  started_at: "2026-10-12T10:00:00.000Z",
  finished_at: "2026-10-12T10:01:00.000Z",
  duration_ms: 60000,
  agent_version: 2,
  cases_total: 8,
  cases_done: 8,
  cases_scored: 8,
  cases_passed: 6,
  recall: 0.82,
  precision: 0.7,
  citation_accuracy: 1,
  cost_usd: 0.05,
  error: null,
  ...over,
});

function renderTab() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: evalMessages, common: commonMessages }}>
      <EvalsTab agentId="ag1" />
    </NextIntlClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  startMutate.mockClear();
  deleteMutate.mockClear();
});

describe("Agent EvalsTab", () => {
  it("shows the latest completed run's recall with the delta versus the previous one", () => {
    cases = [mkCase("c1", "case-one")];
    runs = [mkRun("r2"), mkRun("r1", { recall: 0.78, cost_usd: 0.04 })];
    renderTab();
    const card = screen.getByRole("group", { name: "RECALL" });
    expect(within(card).getByText("82%")).toBeInTheDocument();
    expect(within(card).getByText("+4")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Run all evals" }));
    expect(startMutate).toHaveBeenCalledTimes(1);
  });

  it("disables Run all evals with the reason while a run is in progress", () => {
    cases = [mkCase("c1", "case-one")];
    runs = [mkRun("r2", { status: "running", cases_done: 3, cases_total: 8 }), mkRun("r1")];
    renderTab();
    expect(screen.getByText("3 / 8 cases")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run all evals" })).toBeDisabled();
    expect(screen.getByText("Eval run already in progress")).toBeInTheDocument();
  });

  it("shows never run, an errored reason, and an expected-versus-got result", () => {
    cases = [
      mkCase("c1", "never-case"),
      mkCase("c2", "errored-case", {
        latest_result: { eval_run_id: "r1", case_revision_id: "rev-c2", status: "errored", expected: 1, got: null, error: "timed out" },
      }),
      mkCase("c3", "failed-case", {
        latest_result: { eval_run_id: "r1", case_revision_id: "rev-c3", status: "failed", expected: 1, got: 0, error: null },
      }),
    ];
    runs = [mkRun("r1")];
    renderTab();
    expect(screen.getByText("never run")).toBeInTheDocument();
    expect(screen.getByText("errored: timed out")).toBeInTheDocument();
    expect(screen.getByText("expected 1 finding, got 0")).toBeInTheDocument();
  });

  it("renders an unknown run cost as an em dash", () => {
    cases = [mkCase("c1", "case-one")];
    runs = [mkRun("r1", { cost_usd: null })];
    renderTab();
    const history = screen.getByRole("table", { name: "Run history" });
    expect(within(history).getByText("—")).toBeInTheDocument();
  });

  it("deletes a case only after confirmation", () => {
    cases = [mkCase("c1", "case-one")];
    runs = [];
    renderTab();
    fireEvent.click(screen.getByRole("button", { name: "Delete eval case case-one" }));
    expect(deleteMutate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Delete case" }));
    expect(deleteMutate).toHaveBeenCalledWith("c1");
  });
});
