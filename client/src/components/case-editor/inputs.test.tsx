import { describe, it, expect, afterEach, vi } from "vitest";
import type { ReactElement } from "react";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "@messages/en/eval.json";
import { findingSkeleton, parseCaseDiff, type EvalCaseIssue } from "@devdigest/shared";
import { DiffInput } from "./DiffInput";
import { ExpectationFields } from "./ExpectationFields";
import { ExpectedOutputEditor } from "./ExpectedOutputEditor";

afterEach(cleanup);

function renderWithIntl(ui: ReactElement) {
  render(
    <NextIntlClientProvider locale="en" messages={{ eval: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

const TWO_FILES = [
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -1,2 +1,2 @@",
  " keep();",
  "-const x = '<script>alert(1)</script>';",
  "+const y = 2;",
  "--- a/src/b.ts",
  "+++ b/src/b.ts",
  "@@ -1,1 +1,2 @@",
  " one();",
  "+two();",
].join("\n");

const expectation = { file: "src/a.ts", start_line: 2, end_line: 2 };

describe("DiffInput", () => {
  it("previews markers as text, keeps pasted markup as text and lists files with counts", () => {
    const parse = parseCaseDiff(TWO_FILES);
    renderWithIntl(
      <DiffInput diff={TWO_FILES} prTitle="" prDescription="" parse={parse} issues={[]} readOnly={false} onChange={vi.fn()} />,
    );
    expect(screen.getByLabelText("Diff")).toHaveValue(TWO_FILES);
    expect(screen.getAllByText("+")).toHaveLength(2);
    expect(screen.getAllByText("−")).toHaveLength(1);
    expect(screen.getByText("const x = '<script>alert(1)</script>';")).toBeInTheDocument();
    expect(document.querySelector("script")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Files" }));
    expect(screen.getByText("src/a.ts")).toBeInTheDocument();
    expect(screen.getByText("+1 −1")).toBeInTheDocument();
    expect(screen.getByText("src/b.ts")).toBeInTheDocument();
    expect(screen.getByText("+1 −0")).toBeInTheDocument();
  });

  it("shows the counter and the issue on an over-long title", () => {
    const title = "t".repeat(301);
    const issue: EvalCaseIssue = { field: "pr_title", code: "too_long", line: null, key: null };
    renderWithIntl(
      <DiffInput
        diff=""
        prTitle={title}
        prDescription=""
        parse={parseCaseDiff("")}
        issues={[issue]}
        readOnly={false}
        onChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "PR meta" }));
    expect(screen.getByText("301 / 300")).toBeInTheDocument();
    expect(screen.getByText("Title is longer than 300 characters")).toBeInTheDocument();
    expect(screen.getByLabelText("Title")).toHaveAttribute("aria-invalid", "true");
  });
});

describe("ExpectationFields", () => {
  it("exposes the controls by their accessible names", () => {
    const onChange = vi.fn();
    renderWithIntl(
      <ExpectationFields
        expectationType="must_find"
        expectation={expectation}
        files={parseCaseDiff(TWO_FILES).files}
        issues={[]}
        readOnly={false}
        onChange={onChange}
      />,
    );
    expect(screen.getByLabelText("File")).toHaveValue("src/a.ts");
    expect(screen.getByLabelText("Start line")).toHaveValue(2);
    expect(screen.getByLabelText("End line")).toHaveValue(2);
    expect(screen.getByLabelText("must find")).toBeChecked();
    fireEvent.click(screen.getByLabelText("must not flag"));
    expect(onChange).toHaveBeenCalledWith({ expectation_type: "must_not_flag" });
    fireEvent.change(screen.getByLabelText("File"), { target: { value: "src/b.ts" } });
    expect(onChange).toHaveBeenCalledWith({ expectation: { ...expectation, file: "src/b.ts" } });
  });
});

describe("ExpectedOutputEditor", () => {
  it("disables the skeleton on must_not_flag with the hint", () => {
    renderWithIntl(
      <ExpectedOutputEditor
        value="[]"
        expectationType="must_not_flag"
        expectation={expectation}
        issue={null}
        readOnly={false}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "+ Finding skeleton" })).toBeDisabled();
    expect(screen.getByText("Nothing is expected for must_not_flag")).toBeInTheDocument();
    expect(screen.getByText("valid JSON")).toBeInTheDocument();
  });

  it("inserts the skeleton on must_find and shows an issue with the invalid badge", () => {
    const onChange = vi.fn();
    const issue: EvalCaseIssue = { field: "expected_output", code: "json_unknown_key", line: null, key: "foo" };
    renderWithIntl(
      <ExpectedOutputEditor
        value="[{}]"
        expectationType="must_find"
        expectation={expectation}
        issue={issue}
        readOnly={false}
        onChange={onChange}
      />,
    );
    expect(screen.getByText("invalid JSON")).toBeInTheDocument();
    expect(screen.getByText('Unknown key "foo"')).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "+ Finding skeleton" }));
    expect(onChange).toHaveBeenCalledWith(findingSkeleton(expectation));
  });
});
