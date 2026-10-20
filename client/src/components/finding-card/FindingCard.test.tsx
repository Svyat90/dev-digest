import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord } from "@devdigest/shared";
import messages from "@messages/en/prReview.json";
import { FindingCard } from "./FindingCard";

afterEach(cleanup);

const FINDING: FindingRecord = {
  id: "f1",
  severity: "CRITICAL",
  category: "security",
  title: "Hardcoded Stripe secret key",
  file: "src/config.ts",
  start_line: 11,
  end_line: 11,
  rationale: "A **live** Stripe key is committed in source.",
  suggestion: "Move the key to an environment variable.",
  confidence: 0.95,
  kind: "finding",
  trifecta_components: null,
  evidence: null,
  review_id: "r1",
  accepted_at: null,
  dismissed_at: null,
};

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("FindingCard (smoke, both themes)", () => {
  (["dark", "light"] as const).forEach((theme) => {
    it(`renders severity + file:line + rationale in ${theme}`, () => {
      renderWithIntl(
        <div data-theme={theme}>
          <FindingCard f={FINDING} defaultExpanded onAction={() => {}} />
        </div>,
      );
      expect(screen.getByText("Hardcoded Stripe secret key")).toBeInTheDocument();
      expect(screen.getByText("src/config.ts:11")).toBeInTheDocument();
      // category label is shown alongside the severity badge
      expect(screen.getByText("security")).toBeInTheDocument();
    });
  });

  it("fires accept/dismiss actions", () => {
    const onAction = vi.fn();
    renderWithIntl(<FindingCard f={FINDING} defaultExpanded onAction={onAction} />);
    fireEvent.click(screen.getByText("Accept"));
    expect(onAction).toHaveBeenCalledWith("accept");
    fireEvent.click(screen.getByText("Dismiss"));
    expect(onAction).toHaveBeenCalledWith("dismiss");
  });

  describe("eval case action", () => {
    const ACCEPTED: FindingRecord = { ...FINDING, accepted_at: "2026-10-01T00:00:00Z" };
    const ctl = { onCreate: vi.fn(), pending: false, errorCode: null as string | null };

    it("creates a case from an accepted finding", () => {
      const onCreate = vi.fn();
      renderWithIntl(
        <FindingCard f={ACCEPTED} defaultExpanded evalCase={{ ...ctl, onCreate }} />,
      );
      fireEvent.click(screen.getByRole("button", { name: "Turn into eval case" }));
      expect(onCreate).toHaveBeenCalledTimes(1);
    });

    it("disables the action with a hint for an undecided finding", () => {
      renderWithIntl(<FindingCard f={FINDING} defaultExpanded evalCase={ctl} />);
      const btn = screen.getByRole("button", { name: "Turn into eval case" });
      expect(btn).toBeDisabled();
      expect(screen.getByText("Accept or dismiss this finding first")).toBeInTheDocument();
    });

    it("shows 'Eval case exists' instead of the button when a case exists", () => {
      renderWithIntl(
        <FindingCard f={{ ...ACCEPTED, eval_case_id: "c1" }} defaultExpanded evalCase={ctl} />,
      );
      expect(screen.getByText("Eval case exists")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Turn into eval case" })).toBeNull();
    });

    it("names the refusal reason in an alert", () => {
      renderWithIntl(
        <FindingCard
          f={ACCEPTED}
          defaultExpanded
          evalCase={{ ...ctl, errorCode: "eval_case_diff_too_large" }}
        />,
      );
      expect(screen.getByRole("alert")).toHaveTextContent(
        messages.finding.evalCase.errors.eval_case_diff_too_large,
      );
    });

    it("renders no eval action without the evalCase prop", () => {
      renderWithIntl(<FindingCard f={ACCEPTED} defaultExpanded />);
      expect(screen.queryByText("Turn into eval case")).toBeNull();
      expect(screen.queryByText("Eval case exists")).toBeNull();
    });
  });
});
