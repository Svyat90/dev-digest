import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "@messages/en/context.json";
import { AttachableDocList } from "./AttachableDocList";
import type { DocRow } from "./helpers";

afterEach(cleanup);

const row = (path: string, over: Partial<DocRow> = {}): DocRow => ({
  path,
  type: "docs",
  found: true,
  tokens: 120,
  truncated: false,
  attached: false,
  ...over,
});

function renderList(rows: DocRow[], onChange = vi.fn(), selectedPath?: string | null) {
  render(
    <NextIntlClientProvider locale="en" messages={{ context: messages }}>
      <AttachableDocList rows={rows} onChange={onChange} selectedPath={selectedPath} />
    </NextIntlClientProvider>,
  );
  return onChange;
}

describe("AttachableDocList", () => {
  it("appends a ticked document to the attached list", () => {
    const onChange = renderList([row("docs/x.md", { attached: true }), row("docs/api.md")]);
    fireEvent.click(screen.getByRole("checkbox", { name: "Attach docs/api.md" }));
    expect(onChange).toHaveBeenCalledWith(["docs/x.md", "docs/api.md"]);
  });

  it("reorders with the up button", () => {
    const onChange = renderList([
      row("docs/a.md", { attached: true }),
      row("docs/b.md", { attached: true }),
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Move docs/b.md up" }));
    expect(onChange).toHaveBeenCalledWith(["docs/b.md", "docs/a.md"]);
  });

  it("shows a not-found row that can be unticked", () => {
    const onChange = renderList([row("docs/gone.md", { attached: true, found: false, tokens: null })]);
    expect(screen.getByText("not found")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "Attach docs/gone.md" }));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("marks the previewed row as current", () => {
    renderList([row("docs/a.md"), row("docs/b.md")], vi.fn(), "docs/b.md");
    const current = screen.getAllByRole("listitem").filter((li) => li.getAttribute("aria-current") === "true");
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent("docs/b.md");
  });
});
