import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { DownstreamImpact } from "@devdigest/shared";
import blast from "@messages/en/blast.json";
import { BlastGraph } from "./BlastGraph";

afterEach(cleanup);

const DOWNSTREAM: DownstreamImpact[] = [
  {
    symbol: "rateLimit",
    callers: [{ name: "publicRouter", file: "a.ts", line: 1 }],
    endpoints_affected: ["GET /api/public"],
    crons_affected: ["0 * * * *"],
  },
];

describe("BlastGraph", () => {
  it("renders an accessible svg with node labels, a truncated tooltip and the legend", () => {
    const long = "AVeryLongCallerNameThatCannotFitInTheColumn";
    render(
      <NextIntlClientProvider locale="en" messages={{ blast }}>
        <BlastGraph
          downstream={[{ ...DOWNSTREAM[0]!, callers: [{ name: long, file: "a.ts", line: 1 }] }]}
        />
      </NextIntlClientProvider>,
    );
    expect(screen.getByRole("img", { name: blast.graph.ariaLabel })).toBeInTheDocument();
    expect(screen.getByText("rateLimit", { selector: "text" })).toBeInTheDocument();
    expect(screen.getByText("GET /api/public", { selector: "text" })).toBeInTheDocument();
    expect(screen.getByText("0 * * * *", { selector: "text" })).toBeInTheDocument();
    expect(screen.queryByText(long, { selector: "text" })).not.toBeInTheDocument();
    expect(screen.getByText(`${long.slice(0, 21)}…`, { selector: "text" })).toBeInTheDocument();
    expect(screen.getByText(long, { selector: "title" })).toBeInTheDocument();
    expect(screen.getByText(blast.graph.legend.endpoint)).toBeInTheDocument();
  });

  it("shows the empty text when nothing is downstream", () => {
    render(
      <NextIntlClientProvider locale="en" messages={{ blast }}>
        <BlastGraph downstream={[]} />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText(blast.graph.empty)).toBeInTheDocument();
  });
});
