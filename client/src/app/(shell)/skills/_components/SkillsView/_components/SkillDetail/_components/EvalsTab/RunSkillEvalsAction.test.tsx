import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { SkillEvalAgent } from "@devdigest/shared";
import evalMessages from "@messages/en/eval.json";
import skillsMessages from "@messages/en/skills.json";

let agentState: SkillEvalAgent = { agent: null, missing_agent_name: null };
let cases: unknown[] = [{ id: "c1" }];
let runs: { status: string }[] = [];
const startMutate = vi.fn();
const setMutate = vi.fn((_id: string, opts?: { onSuccess?: () => void }) => opts?.onSuccess?.());

vi.mock("@/lib/hooks/eval-cases", () => ({
  useSkillEvalAgent: () => ({ data: agentState, isLoading: false }),
  useSetSkillEvalAgent: () => ({ mutate: setMutate, isPending: false, error: null }),
  useStartSkillEvalRun: () => ({ mutate: startMutate, isPending: false, error: null, submittedAt: 0, reset: vi.fn() }),
  useSkillEvalCases: () => ({ data: cases, isLoading: false }),
  useSkillEvalRuns: () => ({ data: runs, isLoading: false }),
}));

vi.mock("@/lib/hooks/agents", () => ({
  useAgents: () => ({
    data: [
      { id: "a0", name: "Perf Bot" },
      { id: "a1", name: "Security Reviewer" },
    ],
    isLoading: false,
  }),
}));

import { RunSkillEvalsAction } from "./RunSkillEvalsAction";

function renderAction(label: "runAll" | "runOnEvals" = "runAll") {
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: evalMessages, skills: skillsMessages }}>
      <RunSkillEvalsAction skillId="sk1" label={label} />
    </NextIntlClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  agentState = { agent: null, missing_agent_name: null };
  cases = [{ id: "c1" }];
  runs = [];
});

describe("RunSkillEvalsAction", () => {
  it("asks for an agent once, remembers it, then starts the run", () => {
    renderAction();
    fireEvent.click(screen.getByRole("button", { name: "Run all evals" }));
    expect(startMutate).not.toHaveBeenCalled();

    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Agent"), { target: { value: "a1" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Use this agent" }));

    expect(setMutate).toHaveBeenCalledWith("a1", expect.anything());
    expect(startMutate).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("starts at once with a remembered agent and shows via + Change agent", () => {
    agentState = { agent: { id: "a1", name: "Security Reviewer" }, missing_agent_name: null };
    renderAction("runOnEvals");
    expect(screen.getByText("via Security Reviewer")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Change agent" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Run on evals" }));
    expect(startMutate).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("names a deleted remembered agent in the picker", () => {
    agentState = { agent: null, missing_agent_name: "Perf Reviewer" };
    renderAction();
    fireEvent.click(screen.getByRole("button", { name: "Run all evals" }));
    expect(within(screen.getByRole("dialog")).getByText("Perf Reviewer no longer exists")).toBeTruthy();
  });

  it("disables the run while one is in progress and says why", () => {
    agentState = { agent: { id: "a1", name: "Security Reviewer" }, missing_agent_name: null };
    runs = [{ status: "running" }];
    renderAction();
    const btn = screen.getByRole("button", { name: "Run all evals" }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(screen.getByText("eval run already in progress")).toBeTruthy();
  });
});
