import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type {
  EvalWorkspaceAgentRow,
  EvalWorkspaceDashboard,
  EvalWorkspaceRun,
  RunAllEvalsResponse,
} from "@devdigest/shared";
import evalMessages from "@messages/en/eval.json";
import commonMessages from "@messages/en/common.json";
import { ApiError } from "@/lib/api";

let dashboard: EvalWorkspaceDashboard = { agents: [], recent_runs: [] };
let runAllImpl: (opts: { onSuccess?: (r: RunAllEvalsResponse) => void }) => void = () => {};
let runAllError: Error | null = null;
const mutate = vi.fn((_v: undefined, opts: { onSuccess?: (r: RunAllEvalsResponse) => void }) =>
  runAllImpl(opts),
);

vi.mock("@/lib/hooks/eval-dashboard", () => ({
  useEvalDashboard: () => ({ data: dashboard, isLoading: false, isError: false }),
  useRunAllEvals: () => ({
    mutate,
    isPending: false,
    isError: !!runAllError,
    error: runAllError,
  }),
}));

import { EvalDashboardView } from "./EvalDashboardView";

const run = (over: Partial<EvalWorkspaceRun> = {}): EvalWorkspaceRun => ({
  id: "r1",
  agent_id: "a1",
  agent_name: "Reviewer",
  status: "completed",
  started_at: "2026-10-12T10:00:00.000Z",
  finished_at: "2026-10-12T10:01:00.000Z",
  duration_ms: 60000,
  agent_version: 7,
  cases_total: 20,
  cases_done: 20,
  cases_scored: 20,
  cases_passed: 18,
  recall: 0.82,
  precision: 0.7,
  citation_accuracy: 1,
  cost_usd: 0.05,
  error: null,
  ...over,
});

const agent = (over: Partial<EvalWorkspaceAgentRow>): EvalWorkspaceAgentRow => ({
  id: "a1",
  name: "Reviewer",
  provider: "openai",
  model: "gpt-4o",
  enabled: true,
  cases_total: 20,
  running: false,
  latest: null,
  recall_trend: [],
  ...over,
});

function renderView() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: evalMessages, common: commonMessages }}>
      <EvalDashboardView />
    </NextIntlClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  mutate.mockClear();
  runAllError = null;
  runAllImpl = () => {};
});

describe("EvalDashboardView", () => {
  it("shows last-run rows, never-run rows and a failed run's reason", () => {
    dashboard = {
      agents: [
        agent({ latest: run(), recall_trend: [0.7, 0.82] }),
        agent({ id: "a2", name: "Fresh", cases_total: 3 }),
      ],
      recent_runs: [run({ id: "r2", status: "failed", error: "provider down", recall: null })],
    };
    renderView();
    expect(screen.getByText(/Last run v7 · .* · 18\/20 pass/)).toBeInTheDocument();
    expect(screen.getByText("82%")).toBeInTheDocument();
    expect(screen.getByText(/Never run/)).toBeInTheDocument();
    expect(screen.getAllByText("—")).toHaveLength(3);
    expect(screen.getByText("failed")).toBeInTheDocument();
    expect(screen.getByText("provider down")).toBeInTheDocument();
  });

  it("confirms Run all with skipped agents listed, then reports the started count", async () => {
    dashboard = {
      agents: [agent({}), agent({ id: "a2", name: "Empty", cases_total: 0 })],
      recent_runs: [],
    };
    runAllImpl = (opts) =>
      opts.onSuccess?.({
        started: [
          { agent_id: "a1", run_id: "x" },
          { agent_id: "a3", run_id: "y" },
        ],
        skipped: [],
      });
    renderView();
    fireEvent.click(screen.getByRole("button", { name: "Run all agents" }));
    expect(screen.getByText(/Skipped: Empty — no eval cases/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    expect(mutate).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Started 2 eval runs"));
  });

  it("shows the rate-limit refusal inline", () => {
    dashboard = { agents: [agent({})], recent_runs: [] };
    runAllError = new ApiError("raw", 429, "run_start_rate_limited");
    renderView();
    expect(screen.getByRole("alert")).toHaveTextContent("Too many runs — try again in a minute");
  });

  it("disables Run all with the reason when every agent is running", () => {
    dashboard = { agents: [agent({ running: true })], recent_runs: [] };
    renderView();
    expect(screen.getByRole("button", { name: "Run all agents" })).toBeDisabled();
    expect(
      screen.getByText("Every agent with eval cases already has an eval run in progress"),
    ).toBeInTheDocument();
  });
});
