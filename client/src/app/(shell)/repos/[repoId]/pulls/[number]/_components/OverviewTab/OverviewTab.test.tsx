import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import brief from "@messages/en/brief.json";
import prReview from "@messages/en/prReview.json";
import blast from "@messages/en/blast.json";

const idle = { data: undefined, isLoading: false, isError: false };
vi.mock("@/lib/hooks", () => ({
  useIntent: () => ({
    data: { intent: "Intent card text", in_scope: [], out_of_scope: [], confidence: "high", sources: [], missing_context: [], head_sha: "sha-1" },
    isLoading: false,
    isError: false,
  }),
  useRecomputeIntent: () => ({ mutate: vi.fn(), isPending: false }),
  useBlastRadius: () => idle,
  useResyncRepoIntel: () => ({ mutate: vi.fn(), isPending: false }),
  usePrBrief: () => ({ data: null, isLoading: false }),
  useGenerateBrief: () => ({ mutate: vi.fn(), isPending: false, error: null }),
}));

import { OverviewTab } from "./OverviewTab";

afterEach(cleanup);

function setup() {
  render(
    <NextIntlClientProvider locale="en" messages={{ brief, prReview, blast }}>
      <OverviewTab
        prId="pr-1"
        repoId="repo-1"
        repoFullName="o/r"
        headSha="sha-1"
        prBody="The body"
        reviews={[]}
        diffPaths={new Set(["src/a.ts"])}
        onNavigate={vi.fn()}
      />
    </NextIntlClientProvider>,
  );
}

describe("OverviewTab", () => {
  it("renders the PR Brief block above the description, with the Intent card inside it", () => {
    setup();
    const title = screen.getByText("PR Brief");
    const description = screen.getByText("Description");
    expect(title.compareDocumentPosition(description) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole("button", { name: "Generate brief" })).toBeInTheDocument();
    expect(screen.getByText("Intent card text")).toBeInTheDocument();
  });
});
