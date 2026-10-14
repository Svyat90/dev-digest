import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { AgentEvalRunSummary, EvalDashboard } from "@devdigest/shared";
import evalMessages from "@messages/en/eval.json";
import commonMessages from "@messages/en/common.json";
import { ApiError } from "@/lib/api";

const replace = vi.fn();
const push = vi.fn();
let search = "range=30d";
let dashboard: EvalDashboard | undefined;
let queryError: Error | null = null;
let startError: Error | null = null;

vi.mock("next/navigation", () => ({
  useParams: () => ({ agentId: "a1" }),
  useRouter: () => ({ replace, push }),
  usePathname: () => "/evals/a1",
  useSearchParams: () => new URLSearchParams(search),
}));

vi.mock("@/lib/hooks/eval-dashboard", () => ({
  useAgentEvalDashboard: () => ({
    data: dashboard,
    isLoading: false,
    isError: !!queryError,
    error: queryError,
    refetch: vi.fn(),
  }),
}));

vi.mock("@/lib/hooks/evals", () => ({
  useStartEvalRun: () => ({ mutate: vi.fn(), isPending: false, isError: !!startError, error: startError }),
}));

vi.mock("@/lib/hooks/agents", () => ({
  useAgents: () => ({
    data: [
      { id: "a1", name: "Reviewer" },
      { id: "a2", name: "Security" },
    ],
  }),
}));

vi.mock("./_components/AlertBanner", () => ({ AlertBanner: () => <div>alert-banner</div> }));
vi.mock("./_components/MetricCards", () => ({ MetricCards: () => <div>metric-cards</div> }));
vi.mock("./_components/TrendChart", () => ({ TrendChart: () => <div>trend-chart</div> }));
vi.mock("./_components/CompareDialog", () => ({
  CompareDialog: ({ runIds }: { runIds: readonly string[] }) => <div>compare:{runIds.join(",")}</div>,
}));

import { AgentEvalDashboardView } from "./AgentEvalDashboardView";

const run = (over: Partial<AgentEvalRunSummary>): AgentEvalRunSummary => ({
  id: "r1",
  agent_id: "a1",
  status: "completed",
  started_at: "2026-10-12T10:00:00.000Z",
  finished_at: "2026-10-12T10:01:00.000Z",
  duration_ms: 60000,
  agent_version: 3,
  cases_total: 8,
  cases_done: 8,
  cases_scored: 8,
  cases_passed: 6,
  recall: 0.8,
  precision: 0.7,
  citation_accuracy: 1,
  cost_usd: 0.02,
  error: null,
  ...over,
});

const base = (over: Partial<EvalDashboard> = {}): EvalDashboard => ({
  agent: { id: "a1", name: "Reviewer", provider: "openai", model: "gpt-4o" },
  range: "30d",
  cases_total: 8,
  latest: null,
  previous: null,
  running_run: null,
  alert: null,
  trend: [],
  trend_truncated: false,
  runs: [],
  ...over,
});

function renderView() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: evalMessages, common: commonMessages }}>
      <AgentEvalDashboardView />
    </NextIntlClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  replace.mockClear();
  push.mockClear();
  search = "range=30d";
  queryError = null;
  startError = null;
});

describe("AgentEvalDashboardView", () => {
  it("shows the header, one checkbox per completed run and the running progress", () => {
    dashboard = base({
      running_run: run({ id: "r2", status: "running", cases_done: 3 }),
      runs: [run({ id: "r2", status: "running", cases_done: 3 }), run({ id: "r1" })],
      trend: [{ run_id: "r1", started_at: "2026-10-12T10:00:00.000Z", agent_version: 3, recall: 0.8, precision: 0.7, citation_accuracy: 1, cost_usd: 0.02 }],
    });
    renderView();
    expect(screen.getByRole("heading", { name: "Reviewer" })).toBeInTheDocument();
    expect(screen.getByText(/gpt-4o/)).toBeInTheDocument();
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
    expect(screen.getAllByText("3 / 8 cases").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Run eval" })).toBeDisabled();
    expect(screen.getByText("trend-chart")).toBeInTheDocument();
  });

  it("enables Compare only for exactly two selected runs", () => {
    dashboard = base({
      runs: [run({ id: "r1" }), run({ id: "r2" }), run({ id: "r3" })],
      trend: [{ run_id: "r1", started_at: "2026-10-12T10:00:00.000Z", agent_version: 3, recall: 0.8, precision: 0.7, citation_accuracy: 1, cost_usd: null }],
    });
    renderView();
    const compare = screen.getByRole("button", { name: "Compare" });
    expect(compare).toBeDisabled();
    expect(screen.getByText("Select exactly 2 runs")).toBeInTheDocument();
    const boxes = screen.getAllByRole("checkbox");
    fireEvent.click(boxes[0]!);
    expect(compare).toBeDisabled();
    fireEvent.click(boxes[1]!);
    expect(compare).not.toBeDisabled();
    fireEvent.click(compare);
    expect(screen.getByText(/^compare:/)).toBeInTheDocument();
  });

  it("keeps a failed run in the table when the chart is empty, and Show all sets range=all", () => {
    dashboard = base({ runs: [run({ id: "f1", status: "failed", error: "provider down", recall: null })] });
    renderView();
    expect(screen.getByText("No eval runs in the last 30 days")).toBeInTheDocument();
    expect(screen.getByText("provider down")).toBeInTheDocument();
    expect(screen.queryByText("trend-chart")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show all" }));
    expect(replace).toHaveBeenCalledWith("/evals/a1?range=all");
  });

  it("renders not found with a link back on a 404", () => {
    dashboard = undefined;
    queryError = new ApiError("nope", 404, "not_found");
    renderView();
    expect(screen.getByText("Agent not found")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to Eval Dashboard" })).toHaveAttribute("href", "/evals");
  });

  it("pushes the new agent id with the current range from the switcher", () => {
    search = "range=7d";
    dashboard = base({ range: "7d" });
    renderView();
    fireEvent.change(screen.getByLabelText("Agent"), { target: { value: "a2" } });
    expect(push).toHaveBeenCalledWith("/evals/a2?range=7d");
  });

  it("shows the rate-limit refusal inline", () => {
    dashboard = base();
    startError = new ApiError("raw", 429, "run_start_rate_limited");
    renderView();
    expect(screen.getByRole("alert")).toHaveTextContent("Too many runs — try again in a minute");
  });
});
