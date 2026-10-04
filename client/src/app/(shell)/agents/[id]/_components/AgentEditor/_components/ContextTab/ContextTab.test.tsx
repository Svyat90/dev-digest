import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import agentsMessages from "@messages/en/agents.json";
import contextMessages from "@messages/en/context.json";

const doc = (path: string) => ({ path, type: "docs", tokens: 100, truncated: false });
const att = (path: string, over = {}) => ({ path, type: "docs", found: true, tokens: 100, truncated: false, ...over });

let agentData: Record<string, unknown>;
const setMutate = vi.fn();

vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: () => ({ repoId: "r1", activeRepo: { id: "r1", full_name: "acme/app" } }),
}));

vi.mock("@/lib/hooks/project-context", () => ({
  useContextDocs: () => ({
    data: {
      repo: { id: "r1", full_name: "acme/app", cloned: true },
      status: "ok",
      roots: ["docs"],
      documents: [doc("docs/a.md"), doc("docs/b.md"), doc("docs/c.md")],
      total: 3,
    },
    isLoading: false,
    isError: false,
  }),
  useContextDoc: () => ({ data: undefined }),
  useAgentContextDocs: () => ({ data: agentData, isLoading: false, isError: false }),
  useSetAgentContextDocs: () => ({ mutate: setMutate }),
}));

import { ContextTab } from "./ContextTab";

afterEach(() => {
  cleanup();
  setMutate.mockClear();
});

function renderTab(over: Record<string, unknown> = {}) {
  agentData = {
    repo: { id: "r1", full_name: "acme/app", cloned: true },
    own: [att("docs/a.md")],
    inherited: [],
    total_tokens: 100,
    cap_tokens: 12000,
    left_out: [],
    ...over,
  };
  return render(
    <NextIntlClientProvider locale="en" messages={{ agents: agentsMessages, context: contextMessages }}>
      <ContextTab agentId="ag1" />
    </NextIntlClientProvider>,
  );
}

describe("Agent ContextTab", () => {
  it("names the repository and shows N of M attached", () => {
    renderTab();
    expect(screen.getByText("Documents in acme/app")).toBeInTheDocument();
    expect(screen.getByText("1 of 3 attached")).toBeInTheDocument();
  });

  it("ticking appends the path and saves the full ordered list", () => {
    renderTab({ own: [att("docs/a.md")] });
    fireEvent.click(screen.getByRole("checkbox", { name: "Attach docs/b.md" }));
    expect(setMutate).toHaveBeenCalledWith(["docs/a.md", "docs/b.md"]);
  });

  it("move up sends the swapped order", () => {
    renderTab({ own: [att("docs/a.md"), att("docs/b.md")] });
    fireEvent.click(screen.getByRole("button", { name: "Move docs/b.md up" }));
    expect(setMutate).toHaveBeenCalledWith(["docs/b.md", "docs/a.md"]);
  });

  it("keeps a missing attached path as not found and lets it be detached", () => {
    renderTab({ own: [att("docs/gone.md", { found: false, tokens: null, type: null })] });
    expect(screen.getByText("not found")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "Attach docs/gone.md" }));
    expect(setMutate).toHaveBeenCalledWith([]);
  });

  it("does not label an attached path beyond the listing as not found when the server found it", () => {
    renderTab({ own: [att("docs/far.md")] });
    expect(screen.getByRole("checkbox", { name: "Attach docs/far.md" })).toBeChecked();
    expect(screen.queryByText("not found")).toBeNull();
  });

  it("lists inherited documents read-only with the skill name", () => {
    renderTab({ inherited: [{ ...att("docs/s.md"), skill_id: "s1", skill_name: "Security Rubric" }] });
    expect(screen.getByText("from Security Rubric")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "Attach docs/s.md" })).toBeNull();
  });

  it("warns about left-out documents only when there are some", () => {
    renderTab({ left_out: ["docs/big.md"] });
    expect(screen.getByText(/left out of the prompt: docs\/big\.md/)).toBeInTheDocument();
  });

  it("shows no warning when nothing is left out", () => {
    renderTab();
    expect(screen.queryByText(/left out of the prompt/)).toBeNull();
  });
});
