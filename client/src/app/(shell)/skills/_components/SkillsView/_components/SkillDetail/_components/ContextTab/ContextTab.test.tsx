import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import contextMessages from "@messages/en/context.json";

const mutate = vi.fn();
let own: { path: string; type: string; found: boolean; tokens: number; truncated: boolean }[] = [];
const doc = (path: string) => ({ path, type: "docs", found: true, tokens: 100, truncated: false });

vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: () => ({ activeRepo: { id: "r1", full_name: "acme/app" } }),
}));
vi.mock("@/lib/hooks/project-context", () => ({
  useContextDocs: () => ({
    data: {
      repo: { id: "r1", full_name: "acme/app" },
      status: "ok",
      roots: ["docs"],
      documents: [doc("docs/a.md"), doc("docs/b.md"), doc("docs/c.md")],
      total: 3,
    },
    isError: false,
  }),
  useSkillContextDocs: () => ({
    data: { repo: { id: "r1", full_name: "acme/app", cloned: true }, own, total_tokens: 200 },
  }),
  useSetSkillContextDocs: () => ({ mutate }),
  useContextDoc: () => ({ data: undefined, isError: false }),
}));

import { ContextTab } from "./ContextTab";

afterEach(() => {
  cleanup();
  mutate.mockClear();
});

function renderTab() {
  render(
    <NextIntlClientProvider locale="en" messages={{ context: contextMessages }}>
      <ContextTab skillId="sk1" />
    </NextIntlClientProvider>,
  );
}

describe("skill ContextTab", () => {
  it("renders the title and inherit note, and saves an appended path on tick", () => {
    own = [doc("docs/a.md"), doc("docs/b.md")];
    renderTab();
    expect(screen.getByText("Project context to use")).toBeInTheDocument();
    expect(screen.getByText(/inherits these documents/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "Attach docs/c.md" }));
    expect(mutate).toHaveBeenCalledWith(["docs/a.md", "docs/b.md", "docs/c.md"]);
  });

  it("saves the new order on move up", () => {
    own = [doc("docs/a.md"), doc("docs/b.md")];
    renderTab();
    fireEvent.click(screen.getByRole("button", { name: "Move docs/b.md up" }));
    expect(mutate).toHaveBeenCalledWith(["docs/b.md", "docs/a.md"]);
  });

  it("shows the serialized heading and saved paths in order", () => {
    own = [doc("docs/a.md"), doc("docs/b.md")];
    renderTab();
    const pre = document.querySelector("pre")!;
    expect(pre.textContent).toBe("## Project context\ndocs/a.md\ndocs/b.md");
  });

  it("shows the heading only when nothing is attached", () => {
    own = [];
    renderTab();
    expect(document.querySelector("pre")!.textContent).toBe("## Project context");
  });

  it("filters by path ignoring case, attached rows included, without a not-found label", () => {
    own = [doc("docs/a.md"), { ...doc("docs/gone.md"), found: false }];
    renderTab();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "B.MD" } });
    expect(screen.getByRole("checkbox", { name: "Attach docs/b.md" })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "Attach docs/a.md" })).toBeNull();
    expect(screen.queryByRole("checkbox", { name: "Attach docs/gone.md" })).toBeNull();
    expect(screen.queryByText("not found")).toBeNull();
  });
});
