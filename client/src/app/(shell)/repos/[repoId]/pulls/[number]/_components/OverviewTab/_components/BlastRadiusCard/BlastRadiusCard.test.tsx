import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { BlastRadiusResponse } from "@devdigest/shared";
import blast from "@messages/en/blast.json";
import { BlastRadiusCard, type BlastRadiusCardProps } from "./BlastRadiusCard";

vi.mock("@/lib/hooks/blast", () => ({
  usePrHistory: vi.fn(() => ({ data: undefined, isLoading: false, isError: false })),
}));

afterEach(cleanup);

function renderCard(props: Partial<BlastRadiusCardProps> & { blast: BlastRadiusResponse | undefined }) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ blast }}>
      <BlastRadiusCard
        isLoading={false}
        isError={false}
        prId="p1"
        repoFullName="acme/a"
        headSha="head999"
        onResync={() => {}}
        resyncing={false}
        {...props}
      />
    </NextIntlClientProvider>,
  );
}

const RESPONSE: BlastRadiusResponse = {
  changed_symbols: [
    { name: "alpha", file: "src/a.ts", kind: "function" },
    { name: "beta", file: "src/a.ts", kind: "function" },
  ],
  downstream: [
    {
      symbol: "alpha",
      callers: [{ name: "handler", file: "src/b.ts", line: 12 }],
      endpoints_affected: ["GET /users"],
      crons_affected: ["0 * * * *"],
    },
    {
      symbol: "beta",
      callers: [{ name: "worker", file: "src/c.ts", line: 3 }],
      endpoints_affected: [],
      crons_affected: [],
    },
  ],
  summary: "2 symbols · 2 callers · 1 endpoint · 1 cron",
  degraded: false,
  reason: null,
  index_status: "full",
  index_sha: "idx123",
  limits: { max_callers_per_symbol: 20 },
};

describe("BlastRadiusCard", () => {
  it("renders groups: first open with an index-pinned link, endpoint and cron chips, second collapsed", () => {
    renderCard({ blast: RESPONSE });

    expect(screen.getByRole("link", { name: "Open src/b.ts:12 on GitHub" })).toHaveAttribute(
      "href",
      "https://github.com/acme/a/blob/idx123/src/b.ts#L12",
    );
    expect(screen.getByText(blast.tree.endpoints)).toBeInTheDocument();
    expect(screen.getByText("GET /users")).toBeInTheDocument();
    expect(screen.getByText(blast.tree.crons)).toBeInTheDocument();
    expect(screen.getByText("0 * * * *")).toBeInTheDocument();

    const second = screen.getByRole("button", { name: "Expand beta" });
    expect(second).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("src/c.ts:3")).not.toBeInTheDocument();
    fireEvent.click(second);
    expect(screen.getByText("src/c.ts:3")).toBeInTheDocument();
  });

  it("shows the no-callers text with the changed-symbol count, never an empty card", () => {
    renderCard({ blast: { ...RESPONSE, downstream: [] } });
    expect(screen.getByText("2 changed symbol(s), no downstream callers found.")).toBeInTheDocument();
  });

  it("shows the degraded badge, the reason and a Resync button, and still renders the data", () => {
    const onResync = vi.fn();
    renderCard({ blast: { ...RESPONSE, degraded: true, reason: "index_partial" }, onResync });

    expect(screen.getByText(blast.degraded.badge)).toBeInTheDocument();
    expect(screen.getByText(blast.degraded.reason.index_partial)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open src/b.ts:12 on GitHub" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: blast.resync }));
    expect(onResync).toHaveBeenCalledTimes(1);
  });
});
