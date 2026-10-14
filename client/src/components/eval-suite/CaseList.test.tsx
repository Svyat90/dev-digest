import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { EvalCaseCheck, EvalCaseListItem } from "@devdigest/shared";
import evalMessages from "@messages/en/eval.json";
import { CaseList } from "./CaseList";

const mkCase = (id: string, name: string, over: Partial<EvalCaseListItem> = {}): EvalCaseListItem => ({
  id,
  agent_id: "ag1",
  name,
  revision_id: `rev-${id}-2`,
  revision: 2,
  expectation_type: "must_not_flag",
  expectation: { file: "src/a.ts", start_line: 1, end_line: 2 },
  input_file: "src/a.ts",
  input_meta: { pr_title: "t", pr_description: "" },
  provenance: null,
  created_at: "2026-10-12T10:00:00.000Z",
  latest_result: null,
  check: null,
  ...over,
});

const erroredCheck: EvalCaseCheck = {
  id: "k1",
  case_revision_id: "rev-c2-2",
  status: "errored",
  started_at: "2026-10-12T10:00:00.000Z",
  finished_at: "2026-10-12T10:00:02.000Z",
  duration_ms: 2000,
  expected: 0,
  got: null,
  error: "timed out",
  cost_usd: null,
};

function renderList(props: Partial<Parameters<typeof CaseList>[0]> & { cases: EvalCaseListItem[] }) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: evalMessages }}>
      <CaseList onDelete={vi.fn()} {...props} />
    </NextIntlClientProvider>,
  );
}

afterEach(cleanup);

describe("CaseList", () => {
  it("shows 'edited since last run' instead of the stale result", () => {
    renderList({
      cases: [
        mkCase("c1", "edited-case", {
          latest_result: {
            eval_run_id: "r1",
            case_revision_id: "rev-c1-1",
            status: "passed",
            expected: 0,
            got: 0,
            error: null,
          },
        }),
      ],
    });
    expect(screen.getByText("edited since last run")).toBeInTheDocument();
    expect(screen.queryByText("expected 0 findings, got 0")).not.toBeInTheDocument();
  });

  it("shows an errored single-case result with its reason and an em dash for unknown cost", () => {
    renderList({ cases: [mkCase("c2", "check-case", { check: erroredCheck })] });
    expect(screen.getByText(/Last run errored/)).toBeInTheDocument();
    expect(screen.getByText(/timed out/)).toBeInTheDocument();
    expect(screen.getByText(/· —$/)).toBeInTheDocument();
  });

  it("fires edit and run with the item, and shows why run is disabled", () => {
    const onEdit = vi.fn();
    const onRun = vi.fn();
    const one = mkCase("c1", "case-one");
    const two = mkCase("c2", "case-two");
    renderList({
      cases: [one, two],
      onEdit,
      onRun,
      runDisabledReason: (item) => (item.id === "c2" ? "Already running" : null),
    });
    const edit = screen.getByRole("button", { name: /Edit.*case-one/ });
    fireEvent.click(edit);
    expect(onEdit).toHaveBeenCalledWith(one, edit);
    fireEvent.click(screen.getByRole("button", { name: /Run.*case-one/ }));
    expect(onRun).toHaveBeenCalledWith(one);
    expect(screen.getByRole("button", { name: /Run.*case-two/ })).toBeDisabled();
    expect(screen.getByText("Already running")).toBeInTheDocument();
  });

  it("disables delete while a delete is pending and enables it otherwise", () => {
    const cases = [mkCase("c1", "case-one")];
    const { rerender } = renderList({ cases });
    const name = /Delete eval case.*case-one/;
    expect(screen.getByRole("button", { name })).toBeEnabled();
    rerender(
      <NextIntlClientProvider locale="en" messages={{ eval: evalMessages }}>
        <CaseList cases={cases} onDelete={vi.fn()} deleting />
      </NextIntlClientProvider>,
    );
    expect(screen.getByRole("button", { name })).toBeDisabled();
  });

  it("renders no edit or run button when their callbacks are absent", () => {
    renderList({ cases: [mkCase("c1", "case-one")] });
    expect(screen.getByText("never run")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Edit/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Run/ })).not.toBeInTheDocument();
  });
});
