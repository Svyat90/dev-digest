import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { NAV, resolveHref } from "@devdigest/ui";
import contextMessages from "@messages/en/context.json";
import shellMessages from "@messages/en/shell.json";
import { ProjectContextView } from "./ProjectContextView";

afterEach(cleanup);

const h = vi.hoisted(() => ({
  list: { data: undefined as unknown, isLoading: false, isError: false },
  attachAgent: vi.fn(),
  attachSkill: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useParams: () => ({ repoId: "r1" }) }));
vi.mock("@/components/app-shell", () => ({ useCrumb: () => undefined }));
vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: () => ({ activeRepo: { id: "r1", full_name: "acme/widgets" } }),
}));
vi.mock("@/lib/hooks", () => ({
  useAgents: () => ({ data: [{ id: "a1", name: "Security agent" }] }),
  useSkills: () => ({ data: [{ id: "s1", name: "Naming skill" }] }),
}));
vi.mock("@/lib/hooks/project-context", () => ({
  useContextDocs: () => ({ ...h.list, refetch: vi.fn() }),
  useContextDoc: () => ({ data: { path: "docs/a.md", content: "# Hello" }, isLoading: false, isError: false }),
  useContextDocUsage: () => ({
    data: { agents: [{ id: "a1", name: "x" }, { id: "a2", name: "y" }], skills: [{ id: "s1", name: "z" }] },
  }),
  useAttachDocToAgent: () => ({ mutate: h.attachAgent }),
  useAttachDocToSkill: () => ({ mutate: h.attachSkill }),
}));

const docs = [
  { path: "docs/a.md", type: "docs", tokens: 120, truncated: false },
  { path: "specs/b.md", type: "specs", tokens: 300, truncated: true },
];

function setList(over: Record<string, unknown>) {
  h.list = {
    data: {
      repo: { id: "r1", full_name: "acme/widgets" },
      status: "ok",
      roots: ["specs", "docs", "insights"],
      documents: docs,
      total: 2,
      ...over,
    },
    isLoading: false,
    isError: false,
  };
}

function renderView() {
  render(
    <NextIntlClientProvider locale="en" messages={{ context: contextMessages, shell: shellMessages }}>
      <ProjectContextView />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  h.attachAgent.mockClear();
  h.attachSkill.mockClear();
  setList({});
});

describe("ProjectContextView", () => {
  it("lists rows with path, type tag and tokens", () => {
    renderView();
    expect(screen.getByText("docs/a.md")).toBeTruthy();
    expect(screen.getByText("specs")).toBeTruthy();
    expect(screen.getByText(/≈ 120 tokens/)).toBeTruthy();
    expect(screen.getByText("truncated")).toBeTruthy();
  });

  it("says how many documents are not listed over the cap", () => {
    setList({ total: 3 });
    renderView();
    expect(screen.getByText(/1 more documents not listed/)).toBeTruthy();
  });

  it("shows the not-cloned message instead of a list", () => {
    setList({ status: "not_cloned", documents: [], total: 0 });
    renderView();
    expect(screen.getByText(/not cloned yet/)).toBeTruthy();
    expect(screen.queryByText("docs/a.md")).toBeNull();
  });

  it("names the roots in the empty state", () => {
    setList({ documents: [], total: 0 });
    renderView();
    expect(screen.getByText(/specs, docs, insights/)).toBeTruthy();
  });

  it("previews a selected document, shows usage and appends to an agent", () => {
    renderView();
    fireEvent.click(screen.getByText("docs/a.md"));
    expect(screen.getByText("Hello")).toBeTruthy();
    expect(screen.getByText("Used by 2 agents · 1 skills")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Attach to…"), { target: { value: "agent:a1" } });
    expect(h.attachAgent).toHaveBeenCalledWith("docs/a.md");
    expect(h.attachSkill).not.toHaveBeenCalled();
  });
});

describe("sidebar item", () => {
  it("registers Project Context with the g c shortcut", () => {
    const items = NAV.flatMap((g) => g.items);
    const item = items.find((i) => i.key === "context");
    expect(item?.gKey).toBe("c");
    expect(items.filter((i) => i.gKey === "c")).toHaveLength(1);
    expect(resolveHref(item!.href, "r1")).toBe("/repos/r1/context");
  });
});
