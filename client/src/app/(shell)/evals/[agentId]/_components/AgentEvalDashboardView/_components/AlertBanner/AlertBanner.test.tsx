import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { EvalRegressionAlert } from "@devdigest/shared";
import evalMessages from "@messages/en/eval.json";
import { AlertBanner } from "./AlertBanner";

const mkAlert = (over: Partial<EvalRegressionAlert> = {}): EvalRegressionAlert => ({
  metric: "precision",
  drop_points: 2,
  agent_version: 7,
  run_id: "r2",
  previous_run_id: "r1",
  others: [
    { metric: "recall", direction: "up" },
    { metric: "citation_accuracy", direction: "up" },
  ],
  case_sets: { added: 0, removed: 0 },
  ...over,
});

function renderBanner(alert: EvalRegressionAlert) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: evalMessages }}>
      <AlertBanner alert={alert} />
    </NextIntlClientProvider>,
  );
}

afterEach(cleanup);

describe("AlertBanner", () => {
  it("names the dropped metric, the cause and the others that moved the same way", () => {
    renderBanner(mkAlert());
    const banner = screen.getByRole("alert");
    expect(banner).toHaveTextContent("Precision dipped 2pts on v7 — a new false positive slipped in.");
    expect(banner).toHaveTextContent("Recall and citation both up.");
    expect(banner).not.toHaveTextContent("Case sets differ");
  });

  it("lists differing directions separately and adds the case-set notice", () => {
    renderBanner(
      mkAlert({
        others: [
          { metric: "recall", direction: "down" },
          { metric: "citation_accuracy", direction: "up" },
        ],
        case_sets: { added: 1, removed: 1 },
      }),
    );
    const banner = screen.getByRole("alert");
    expect(banner).toHaveTextContent("Recall down, citation up.");
    expect(banner).toHaveTextContent("Case sets differ: 1 added, 1 removed");
  });
});
