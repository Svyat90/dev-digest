import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import evalMessages from "@messages/en/eval.json";
import commonMessages from "@messages/en/common.json";
import type { EvalRunComparison } from "@devdigest/shared";

const state = vi.hoisted(() => ({
  comparison: null as unknown,
  mutate: vi.fn(),
  error: null as unknown,
  toastSuccess: vi.fn(),
}));

vi.mock("@/lib/hooks/eval-dashboard", () => ({
  useEvalRunComparison: () => ({
    data: state.comparison,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  usePromoteEvalRun: () => ({ mutate: state.mutate, error: state.error, isPending: false }),
}));
vi.mock("@/lib/toast", () => ({
  useToast: () => ({ success: state.toastSuccess, error: vi.fn(), info: vi.fn(), toast: vi.fn() }),
}));

import { CompareDialog } from "./CompareDialog";

const run = (id: string, version: number, recall: number | null, cost: number | null) => ({
  id,
  agent_id: "a1",
  status: "completed" as const,
  started_at: "2026-10-01T10:00:00Z",
  finished_at: "2026-10-01T10:01:00Z",
  duration_ms: 60000,
  agent_version: version,
  cases_total: 5,
  cases_done: 5,
  cases_scored: 5,
  cases_passed: 4,
  recall,
  precision: 0.9,
  citation_accuracy: 1,
  cost_usd: cost,
  error: null,
  config: {
    agent_version: version,
    provider: "openai" as const,
    model: "m",
    system_prompt: "p",
    strategy: "single" as const,
    skills: [],
  },
});

function makeComparison(over: Partial<EvalRunComparison> = {}): EvalRunComparison {
  return {
    agent_id: "a1",
    earlier: run("r1", 6, 0.78, 0.05),
    later: run("r2", 7, 0.82, 0.06),
    case_sets: { added: 0, removed: 0 },
    config_changes: [],
    skill_changes: [],
    promote: {
      run_id: "r2",
      run_agent_version: 7,
      current_agent_version: 9,
      is_current: false,
      skills_to_restore: [],
      affected_agents: [],
      deleted_skills: [],
    },
    ...over,
  } as EvalRunComparison;
}

const renderDialog = (onClose = vi.fn()) => {
  render(
    <NextIntlClientProvider locale="en" messages={{ eval: evalMessages, common: commonMessages }}>
      <CompareDialog agentId="a1" runIds={["r1", "r2"]} onClose={onClose} />
    </NextIntlClientProvider>,
  );
  return onClose;
};

beforeEach(() => {
  state.mutate = vi.fn();
  state.error = null;
  state.toastSuccess = vi.fn();
  state.comparison = makeComparison();
});

describe("CompareDialog", () => {
  it("shows metric deltas and the case-set notice", () => {
    state.comparison = makeComparison({ case_sets: { added: 2, removed: 0 } });
    renderDialog();
    expect(screen.getByText("78% → 82%")).toBeTruthy();
    expect(screen.getByText("+4 pt")).toBeTruthy();
    expect(screen.getByText("Case sets differ: 2 added, 0 removed")).toBeTruthy();
    expect(screen.getByText("System prompt unchanged")).toBeTruthy();
    expect(screen.getByText("No other configuration changes")).toBeTruthy();
  });

  it("shows an em dash for unknown cost", () => {
    const c = makeComparison();
    c.earlier.cost_usd = null;
    state.comparison = c;
    renderDialog();
    expect(screen.getByText("— → $0.06")).toBeTruthy();
  });

  it("renders a prompt containing HTML as literal text with markers", () => {
    const c = makeComparison();
    c.later.config.system_prompt = "<b>x</b>";
    state.comparison = c;
    renderDialog();
    expect(screen.getByText("<b>x</b>")).toBeTruthy();
    expect(screen.getByText("+")).toBeTruthy();
    expect(screen.getByText("−")).toBeTruthy();
  });

  it("disables Promote with a hint when the run is the current configuration", () => {
    const c = makeComparison();
    c.promote.is_current = true;
    state.comparison = c;
    renderDialog();
    const btn = screen.getByRole("button", { name: "Promote v7" });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("This is the current configuration")).toBeTruthy();
  });

  it("promotes after confirmation, toasts and closes", () => {
    state.mutate = vi.fn((_id: string, opts: { onSuccess: (r: unknown) => void }) =>
      opts.onSuccess({ agent_id: "a1", agent_version: 9, run_agent_version: 7, restored_skills: [] }),
    );
    const onClose = renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Promote v7" }));
    fireEvent.click(screen.getByRole("button", { name: "Promote" }));
    expect(state.mutate).toHaveBeenCalledWith("r2", expect.anything());
    expect(state.toastSuccess).toHaveBeenCalledWith("Promoted run v7 as v9");
    expect(onClose).toHaveBeenCalled();
  });

  it("shows the mapped reason for a refused promotion", () => {
    state.error = Object.assign(new Error("x"), { code: "eval_promote_noop" });
    renderDialog();
    expect(screen.getByRole("alert").textContent).toContain("already the current configuration");
  });
});
