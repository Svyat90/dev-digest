import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { EvalCaseDraft } from "@devdigest/shared";

vi.mock("@/lib/api", () => ({
  api: { get: vi.fn(), put: vi.fn(), post: vi.fn(), patch: vi.fn(), del: vi.fn() },
}));

import { api } from "@/lib/api";
import {
  useCreateEvalCaseDraft,
  useEvalCase,
  useSetSkillEvalAgent,
  useStartEvalCaseCheck,
} from "./eval-cases";

const mocked = api as unknown as Record<"get" | "post" | "put", ReturnType<typeof vi.fn>>;

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { qc, wrapper };
}

const draft: EvalCaseDraft = {
  name: "manual-case",
  input_diff: "--- a/x.ts\n+++ b/x.ts\n@@ -1 +1,2 @@\n a\n+b\n",
  pr_title: "",
  pr_description: "",
  expectation_type: "must_not_flag",
  expectation: { file: "x.ts", start_line: 2, end_line: 2 },
  expected_output_json: "[]",
};

beforeEach(() => {
  mocked.get.mockReset();
  mocked.post.mockReset();
  mocked.put.mockReset();
});

describe("eval case hooks", () => {
  it("useCreateEvalCaseDraft posts the draft to the owner's case list", async () => {
    mocked.post.mockResolvedValue({ case: { id: "c1" }, revision_created: true });
    const { wrapper } = setup();
    const { result } = renderHook(() => useCreateEvalCaseDraft({ kind: "skill", id: "s1" }), { wrapper });

    act(() => result.current.mutate(draft));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mocked.post).toHaveBeenCalledWith("/skills/s1/eval-cases", draft);
  });

  it("useStartEvalCaseCheck posts the check with no body", async () => {
    mocked.post.mockResolvedValue({ check_id: "k1" });
    const { wrapper } = setup();
    const { result } = renderHook(() => useStartEvalCaseCheck({ kind: "agent", id: "a1" }), { wrapper });

    act(() => result.current.mutate("c1"));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mocked.post).toHaveBeenCalledWith("/agents/a1/eval-cases/c1/check");
    expect(mocked.post.mock.calls[0]).toHaveLength(1);
  });

  it("useEvalCase polls every 2 s only while its check is running", async () => {
    mocked.get.mockResolvedValue({ id: "c1", check: { status: "running" } });
    const { qc, wrapper } = setup();
    const { result } = renderHook(() => useEvalCase({ kind: "agent", id: "a1" }, "c1"), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(mocked.get).toHaveBeenCalledWith("/agents/a1/eval-cases/c1");

    const options = qc.getQueryCache().find({ queryKey: ["eval-case", "agent", "a1", "c1"] })!.observers[0]!
      .options as { refetchInterval: (q: unknown) => number | false };
    const at = (data: unknown) => options.refetchInterval({ state: { data } });
    expect(at({ check: { status: "running" } })).toBe(2000);
    expect(at({ check: { status: "passed" } })).toBe(false);
    expect(at({ check: null })).toBe(false);
  });

  it("useSetSkillEvalAgent puts the chosen agent and caches the answer", async () => {
    const answer = { agent: { id: "ag1", name: "Security Reviewer" }, missing_agent_name: null };
    mocked.put.mockResolvedValue(answer);
    const { qc, wrapper } = setup();
    const { result } = renderHook(() => useSetSkillEvalAgent("s1"), { wrapper });

    act(() => result.current.mutate("ag1"));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mocked.put).toHaveBeenCalledWith("/skills/s1/eval-agent", { agent_id: "ag1" });
    expect(qc.getQueryData(["skill-eval-agent", "s1"])).toEqual(answer);
  });
});
