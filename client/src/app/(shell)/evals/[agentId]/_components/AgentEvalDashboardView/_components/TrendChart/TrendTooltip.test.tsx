import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import evalMessages from "@messages/en/eval.json";
import type { EvalTrendPoint } from "@/vendor/shared";
import { TrendTooltip } from "./TrendTooltip";

const point: EvalTrendPoint = {
  run_id: "r1",
  started_at: "2026-10-01T10:00:00Z",
  agent_version: 7,
  recall: 0.823,
  precision: null,
  citation_accuracy: 0.9,
  cost_usd: null,
};

const ui = (p: EvalTrendPoint) => (
  <NextIntlClientProvider locale="en" messages={{ eval: evalMessages }}>
    <TrendTooltip point={p} />
  </NextIntlClientProvider>
);

describe("TrendTooltip", () => {
  it("shows version, metrics and an em dash for unknown values and cost", () => {
    render(ui(point));
    expect(screen.getByText("v7")).toBeTruthy();
    expect(screen.getByText("82%")).toBeTruthy();
    expect(screen.getByText("Cost —")).toBeTruthy();
  });

  it("formats a known cost", () => {
    render(ui({ ...point, cost_usd: 0.0135 }));
    expect(screen.getByText("Cost $0.014")).toBeTruthy();
  });
});
