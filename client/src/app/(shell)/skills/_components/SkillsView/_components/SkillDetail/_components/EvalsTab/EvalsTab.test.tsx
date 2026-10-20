import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { EvalCaseListItem, Skill, SkillEvalAgent, SkillEvalRunSummary } from "@devdigest/shared";
import evalMessages from "@messages/en/eval.json";
import skillsMessages from "@messages/en/skills.json";
import commonMessages from "@messages/en/common.json";

let cases: EvalCaseListItem[] = [];
let runs: SkillEvalRunSummary[] = [];
let agentState: SkillEvalAgent = { agent: { id: "a1", name: "Security Reviewer" }, missing_agent_name: null };
const editorProps = vi.fn();

vi.mock("@/lib/hooks/eval-cases", () => ({
  useSkillEvalCases: () => ({ data: cases, isLoading: false }),
  useSkillEvalRuns: () => ({ data: runs, isLoading: false }),
  useSkillEvalAgent: () => ({ data: agentState, isLoading: false }),
  useSetSkillEvalAgent: () => ({ mutate: vi.fn(), isPending: false, error: null }),
  useStartSkillEvalRun: () => ({ mutate: vi.fn(), isPending: false, error: null, submittedAt: 0, reset: vi.fn() }),
  useStartEvalCaseCheck: () => ({ mutate: vi.fn(), isPending: false, error: null, submittedAt: 0, reset: vi.fn() }),
  useDeleteSkillEvalCase: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("@/lib/hooks/agents", () => ({
  useAgents: () => ({ data: [{ id: "a1", name: "Security Reviewer" }], isLoading: false }),
}));

vi.mock("@/components/case-editor", () => ({
  CaseEditor: (props: { owner: { kind: string; id: string }; ownerName: string }) => {
    editorProps(props);
    return <div role="dialog" aria-label="Case editor mock">{`${props.owner.kind}:${props.owner.id}`}</div>;
  },
}));

vi.mock("@/lib/hooks/useSearchParamState", () => ({
  useSearchParamState: () => ["evals", vi.fn()],
}));

import { SkillEvalsTab } from "./index";
import { SkillDetail } from "../../SkillDetail";

const skill: Skill = {
  id: "sk1",
  name: "no-sql-injection",
  description: "d",
  type: "security",
  source: "manual",
  body: "b",
  enabled: true,
  version: 5,
};

const mkCase = (id: string, name: string): EvalCaseListItem => ({
  id,
  agent_id: null,
  name,
  revision_id: `rev-${id}`,
  revision: 1,
  expectation_type: "must_not_flag",
  expectation: { file: "src/a.ts", start_line: 2, end_line: 2 },
  input_file: "src/a.ts",
  input_meta: { pr_title: "", pr_description: "" },
  provenance: null,
  created_at: "2026-10-12T10:00:00.000Z",
  latest_result: null,
  check: null,
});

const mkRun = (id: string, over: Partial<SkillEvalRunSummary> = {}): SkillEvalRunSummary => ({
  id,
  skill_id: "sk1",
  skill_version: 5,
  agent_id: "a1",
  agent_name: "Security Reviewer",
  agent_deleted: false,
  status: "completed",
  started_at: "2026-10-12T10:00:00.000Z",
  finished_at: "2026-10-12T10:01:00.000Z",
  duration_ms: 60000,
  agent_version: 3,
  cases_total: 20,
  cases_done: 20,
  cases_scored: 20,
  cases_passed: 17,
  recall: 0.82,
  precision: 0.7,
  citation_accuracy: 1,
  cost_usd: 0.05,
  error: null,
  ...over,
});

const messages = { eval: evalMessages, skills: skillsMessages, common: commonMessages };

function renderTab() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <SkillEvalsTab skill={skill} />
    </NextIntlClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  cases = [];
  runs = [];
  agentState = { agent: { id: "a1", name: "Security Reviewer" }, missing_agent_name: null };
});

describe("Skill EvalsTab", () => {
  it("lists the skill's cases as never run, with no metrics before a completed run", () => {
    cases = [mkCase("c1", "manual-case")];
    renderTab();
    expect(screen.getByText("manual-case")).toBeInTheDocument();
    expect(screen.getByText("never run")).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "RECALL" })).toBeNull();
    expect(screen.queryByText(/passing/)).toBeNull();
  });

  it("shows the empty text when the skill has no cases", () => {
    renderTab();
    expect(screen.getByText("No eval cases yet. Create one to measure this skill.")).toBeInTheDocument();
  });

  it("shows metric cards, x / N passing and history rows with agent and skill versions", () => {
    cases = [mkCase("c1", "manual-case")];
    runs = [
      mkRun("r2"),
      mkRun("r1", { recall: 0.78, agent_id: null, agent_name: "Perf Reviewer", agent_deleted: true }),
    ];
    renderTab();
    const card = screen.getByRole("group", { name: "RECALL" });
    expect(within(card).getByText("82%")).toBeInTheDocument();
    expect(screen.getByText("17 / 20 passing")).toBeInTheDocument();
    const history = screen.getByRole("table", { name: "Run history" });
    expect(within(history).getByText("via Security Reviewer v3 · skill v5")).toBeInTheDocument();
    expect(within(history).getByText("via Perf Reviewer (deleted) v3 · skill v5")).toBeInTheDocument();
  });

  it("opens the Case Editor with the skill as owner from New eval case", () => {
    cases = [mkCase("c1", "manual-case")];
    renderTab();
    fireEvent.click(screen.getByRole("button", { name: "New eval case" }));
    expect(screen.getByRole("dialog", { name: "Case editor mock" })).toHaveTextContent("skill:sk1");
    expect(editorProps).toHaveBeenLastCalledWith(
      expect.objectContaining({
        ownerName: "no-sql-injection",
        caseId: null,
        otherNames: ["manual-case"],
        runBlocker: null,
        viaAgentName: "Security Reviewer",
      }),
    );
  });

  it("blocks row runs with the reason when the skill has no agent", () => {
    agentState = { agent: null, missing_agent_name: null };
    cases = [mkCase("c1", "manual-case")];
    renderTab();
    expect(screen.getByRole("button", { name: "Run manual-case" })).toBeDisabled();
    expect(screen.getAllByText("Choose an agent for this skill first").length).toBeGreaterThan(0);
  });
});

describe("SkillDetail with the Evals tab", () => {
  it("puts Evals right after Preview and Run on evals in the header", () => {
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <SkillDetail skill={skill} />
      </NextIntlClientProvider>,
    );
    const labels = screen.getAllByRole("button").map((b) => b.textContent?.trim() ?? "");
    const preview = labels.indexOf("Preview");
    expect(preview).toBeGreaterThanOrEqual(0);
    expect(labels[preview + 1]).toBe("Evals");
    expect(screen.getByRole("button", { name: "Run on evals" })).toBeInTheDocument();
  });
});
