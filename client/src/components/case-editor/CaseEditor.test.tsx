import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "@messages/en/eval.json";
import type { EvalCaseDetail, EvalCaseOwner } from "@devdigest/shared";
import { ApiError } from "@/lib/api";
import { CaseEditor, type CaseEditorProps } from "./index";

const hooks = vi.hoisted(() => ({
  detail: null as unknown,
  create: vi.fn(),
  update: vi.fn(),
  check: vi.fn(),
}));

vi.mock("@/lib/hooks/eval-cases", () => ({
  useEvalCase: (_owner: unknown, caseId: string | null) => {
    const detail = hooks.detail as { id: string } | null;
    return { data: caseId && detail?.id === caseId ? detail : undefined, isLoading: false, isError: false };
  },
  useCreateEvalCaseDraft: () => ({ mutateAsync: hooks.create, isPending: false }),
  useUpdateEvalCase: () => ({ mutateAsync: hooks.update, isPending: false }),
  useStartEvalCaseCheck: () => ({ mutateAsync: hooks.check, isPending: false }),
}));

const owner: EvalCaseOwner = { kind: "agent", id: "agent-1" };

const VALID_DIFF = [
  "--- a/src/e2e.ts",
  "+++ b/src/e2e.ts",
  "@@ -1,2 +1,3 @@",
  " const a = 1;",
  "+const b = 2;",
  " export { a };",
].join("\n");

function detailOf(over: Partial<EvalCaseDetail> = {}): EvalCaseDetail {
  return {
    id: "case-1",
    agent_id: "agent-1",
    name: "e2e-manual-case",
    revision_id: "rev-1",
    revision: 1,
    expectation_type: "must_not_flag",
    expectation: { file: "src/e2e.ts", start_line: 2, end_line: 2 },
    input_file: "src/e2e.ts",
    input_meta: { pr_title: "", pr_description: "" },
    provenance: null,
    created_at: "2026-10-13T00:00:00.000Z",
    owner,
    origin: "manual",
    input_diff: VALID_DIFF,
    input_files: ["src/e2e.ts"],
    expected_output: [],
    latest_result: null,
    check: null,
    last_run: null,
    ...over,
  };
}

function renderEditor(props: Partial<CaseEditorProps> = {}) {
  const onClose = vi.fn();
  render(
    <NextIntlClientProvider locale="en" messages={{ eval: messages }}>
      <CaseEditor
        owner={owner}
        ownerName="Security Reviewer"
        caseId={null}
        otherNames={[]}
        runBlocker={null}
        viaAgentName={null}
        returnFocusTo={null}
        onClose={onClose}
        {...props}
      />
    </NextIntlClientProvider>,
  );
  return { onClose };
}

const settle = () => act(() => vi.advanceTimersByTime(300));

function fillValidForm() {
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "e2e-manual-case" } });
  fireEvent.change(screen.getByLabelText("Diff"), { target: { value: VALID_DIFF } });
  fireEvent.click(screen.getByLabelText("must not flag"));
  settle();
  fireEvent.change(screen.getByLabelText("File"), { target: { value: "src/e2e.ts" } });
  fireEvent.change(screen.getByLabelText("Start line"), { target: { value: "2" } });
  fireEvent.change(screen.getByLabelText("End line"), { target: { value: "2" } });
  settle();
}

// Node 22+ ships its own `localStorage` global, which shadows jsdom's and is
// undefined without --localstorage-file: give the test an in-memory one.
function memoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (k) => store.get(k) ?? null,
    key: (i) => [...store.keys()][i] ?? null,
    removeItem: (k) => void store.delete(k),
    setItem: (k, v) => void store.set(k, String(v)),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("localStorage", memoryStorage());
  hooks.detail = null;
  hooks.create.mockReset();
  hooks.update.mockReset();
  hooks.check.mockReset();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("CaseEditor", () => {
  it("opens a new case with the owner line, Run on save off and Run case blocked", () => {
    renderEditor();
    expect(screen.getByText("New eval case")).toBeInTheDocument();
    expect(screen.getByText("Agent · Security Reviewer")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Run on save" })).toHaveAttribute("aria-checked", "false");
    const run = screen.getByRole("button", { name: "Run case" });
    expect(run).toBeDisabled();
    expect(run).toHaveAccessibleDescription("Save first");
  });

  it("names a stray diff line after the debounce and keeps Save disabled", () => {
    renderEditor();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "stray" } });
    fireEvent.change(screen.getByLabelText("Diff"), { target: { value: "hello\n--- a/x\n+++ b/x" } });
    expect(screen.queryByText("Line 1 is outside a hunk and is not a file header")).toBeNull();
    settle();
    expect(screen.getByText("Line 1 is outside a hunk and is not a file header")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("saves a valid form once and retitles the dialog", async () => {
    hooks.create.mockResolvedValue({ case: detailOf(), revision_created: true });
    renderEditor();
    fillValidForm();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });
    expect(hooks.create).toHaveBeenCalledTimes(1);
    expect(hooks.create).toHaveBeenCalledWith({
      name: "e2e-manual-case",
      input_diff: VALID_DIFF,
      pr_title: "",
      pr_description: "",
      expectation_type: "must_not_flag",
      expectation: { file: "src/e2e.ts", start_line: 2, end_line: 2 },
      expected_output_json: "[]",
    });
    expect(screen.getByText("Eval case · e2e-manual-case")).toBeInTheDocument();
    expect(hooks.check).not.toHaveBeenCalled();
  });

  it("shows a server-side name clash under the name", async () => {
    hooks.create.mockRejectedValue(
      new ApiError("invalid", 422, "eval_case_invalid", {
        issues: [{ field: "name", code: "name_taken", line: null, key: null }],
      }),
    );
    renderEditor();
    fillValidForm();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });
    expect(screen.getByText("Another case in this set already has this name")).toBeInTheDocument();
  });

  it("checks the new case after save when Run on save is on", async () => {
    hooks.create.mockResolvedValue({ case: detailOf({ id: "case-9" }), revision_created: true });
    hooks.check.mockResolvedValue({ check_id: "chk-1" });
    renderEditor();
    fireEvent.click(screen.getByRole("switch", { name: "Run on save" }));
    expect(localStorage.getItem("dd-eval-run-on-save")).toBe("1");
    fillValidForm();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });
    expect(hooks.check).toHaveBeenCalledWith("case-9");
  });

  it("blocks Run case while a check is running", () => {
    hooks.detail = detailOf({
      check: {
        id: "chk-1",
        case_revision_id: "rev-1",
        status: "running",
        started_at: "2026-10-13T00:00:00.000Z",
        finished_at: null,
        duration_ms: null,
        expected: 0,
        got: null,
        error: null,
        cost_usd: null,
      },
    });
    renderEditor({ caseId: "case-1" });
    expect(screen.getByText("Eval case · e2e-manual-case")).toBeInTheDocument();
    const run = screen.getByRole("button", { name: "Run case" });
    expect(run).toBeDisabled();
    expect(run).toHaveAccessibleDescription("Already running");
  });

  it("disables Run case after a 429 with the rate-limit reason", async () => {
    hooks.detail = detailOf();
    hooks.check.mockRejectedValue(new ApiError("slow down", 429, "run_start_rate_limited", { retry_after_ms: 60_000 }));
    renderEditor({ caseId: "case-1" });
    const run = screen.getByRole("button", { name: "Run case" });
    expect(run).toBeEnabled();
    await act(async () => {
      fireEvent.click(run);
    });
    expect(hooks.check).toHaveBeenCalledWith("case-1");
    expect(screen.getByText("Too many runs — try again in a minute")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run case" })).toBeDisabled();
  });

  it("keeps a finding-made case's content fixed", () => {
    hooks.detail = detailOf({ origin: "finding" });
    renderEditor({ caseId: "case-1" });
    expect(screen.getByLabelText("Diff")).toBeDisabled();
    expect(screen.getByLabelText("Name")).toBeEnabled();
    expect(screen.getByText("Created from a finding — input and expectation are fixed")).toBeInTheDocument();
  });

  it("closes on Escape", () => {
    const { onClose } = renderEditor();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
