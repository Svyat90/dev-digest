import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import blast from "@messages/en/blast.json";
import { usePrHistory } from "@/lib/hooks/blast";
import { PriorPrs } from "./PriorPrs";

vi.mock("@/lib/hooks/blast", () => ({ usePrHistory: vi.fn() }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const mockHistory = (data: unknown) =>
  vi.mocked(usePrHistory).mockReturnValue({ data, isLoading: false, isError: false } as never);

function renderIt() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ blast }}>
      <PriorPrs prId="p1" repoFullName="acme/a" />
    </NextIntlClientProvider>,
  );
}

describe("PriorPrs", () => {
  it("is collapsed and not fetching until opened, then links each prior PR", () => {
    mockHistory({
      degraded: false,
      reason: null,
      history: [
        {
          pr_number: 42,
          title: "Harden the parser",
          merged_at: "2026-01-02T00:00:00Z",
          author: "dev",
          files_overlap: ["src/a.ts"],
          notes: "touched 1 of these files",
        },
      ],
    });
    renderIt();
    expect(vi.mocked(usePrHistory)).toHaveBeenLastCalledWith("p1", false);
    expect(screen.queryByText("Harden the parser")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: blast.history.expand }));
    expect(vi.mocked(usePrHistory)).toHaveBeenLastCalledWith("p1", true);
    expect(screen.getByRole("link", { name: "#42" })).toHaveAttribute(
      "href",
      "https://github.com/acme/a/pull/42",
    );
    expect(screen.getByText("Harden the parser")).toBeInTheDocument();
  });

  it("shows the degraded sentence instead of the empty text", () => {
    mockHistory({ degraded: true, reason: "github_unavailable", history: [] });
    renderIt();
    fireEvent.click(screen.getByRole("button", { name: blast.history.expand }));
    expect(screen.getByText(blast.history.degraded.github_unavailable)).toBeInTheDocument();
    expect(screen.queryByText(blast.history.empty)).not.toBeInTheDocument();
  });
});
