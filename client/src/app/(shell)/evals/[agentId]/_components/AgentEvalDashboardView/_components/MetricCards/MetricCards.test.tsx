import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { AgentEvalRunSummary, EvalTrendPoint } from "@devdigest/shared";
import evalMessages from "@messages/en/eval.json";
import { MetricCards } from "./MetricCards";

const mkRun = (over: Partial<AgentEvalRunSummary> = {}): AgentEvalRunSummary => ({
  id: "r",
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

const pt = (i: number, recall: number | null): EvalTrendPoint => ({
  run_id: `r${i}`,
  started_at: "2026-10-12T10:00:00.000Z",
  agent_version: 1,
  recall,
  precision: null,
  citation_accuracy: null,
  cost_usd: null,
});

function renderCards(props: React.ComponentProps<typeof MetricCards>) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: evalMessages }}>
      <MetricCards {...props} />
    </NextIntlClientProvider>,
  );
}

afterEach(cleanup);

describe("MetricCards", () => {
  it("shows the whole percent with a signed point delta", () => {
    renderCards({ latest: mkRun(), previous: mkRun({ recall: 0.78, precision: 0.7 }), trend: [] });
    expect(screen.getByText("82%")).toBeInTheDocument();
    expect(screen.getByText("+4 pt")).toBeInTheDocument();
    expect(screen.getAllByText("0 pt").length).toBeGreaterThan(0);
  });

  it("shows no delta without a previous run and no sparkline for one value", () => {
    const { container } = renderCards({ latest: mkRun(), previous: null, trend: [pt(1, 0.8)] });
    expect(screen.queryByText(/ pt$/)).toBeNull();
    expect(container.querySelector("svg path")).toBeNull();
  });
});
