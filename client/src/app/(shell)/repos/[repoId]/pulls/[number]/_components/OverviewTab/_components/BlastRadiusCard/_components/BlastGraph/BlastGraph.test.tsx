import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { DownstreamImpact } from "@devdigest/shared";
import blast from "@messages/en/blast.json";
import { BlastGraph } from "./BlastGraph";
import { NODE_STROKES, NODE_STYLES } from "./styles";

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

  it("colours legend dots like the node outlines and lists cron only when a cron node exists", () => {
    const view = (downstream: DownstreamImpact[]) => (
      <NextIntlClientProvider locale="en" messages={{ blast }}>
        <BlastGraph downstream={downstream} />
      </NextIntlClientProvider>
    );
    const dot = (label: string) => screen.getByText(label).querySelector("span") as HTMLElement;
    const { rerender } = render(view(DOWNSTREAM));
    expect(dot(blast.graph.legend.symbol).style.background).toBe(NODE_STYLES.symbol.box.stroke);
    expect(dot(blast.graph.legend.caller).style.background).toBe(NODE_STYLES.caller.box.stroke);
    expect(dot(blast.graph.legend.endpoint).style.background).toBe(NODE_STYLES.endpoint.box.stroke);
    expect(dot(blast.graph.legend.cron).style.background).toBe(NODE_STROKES.cron);

    rerender(view([{ ...DOWNSTREAM[0]!, crons_affected: [] }]));
    expect(screen.queryByText(blast.graph.legend.cron)).not.toBeInTheDocument();
  });
});
