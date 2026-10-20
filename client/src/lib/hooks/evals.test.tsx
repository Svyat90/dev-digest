import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/lib/api", () => ({
  api: { get: vi.fn(), put: vi.fn(), post: vi.fn(), patch: vi.fn(), del: vi.fn() },
}));

import { api } from "@/lib/api";
import { useAgentEvalRuns, useFindingEvalCaseAction } from "./evals";

const mocked = api as unknown as Record<"get" | "post", ReturnType<typeof vi.fn>>;

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { qc, wrapper };
}

beforeEach(() => {
  mocked.get.mockReset();
  mocked.post.mockReset();
});

describe("eval hooks", () => {
  it("useFindingEvalCaseAction posts the finding and reports pending for that finding only", async () => {
    let resolve!: (v: unknown) => void;
    mocked.post.mockReturnValue(new Promise((r) => (resolve = r)));
    const { qc, wrapper } = setup();
    const { result } = renderHook(() => useFindingEvalCaseAction(), { wrapper });

    act(() => result.current("f1").onCreate());
    await waitFor(() => expect(result.current("f1").pending).toBe(true));
    expect(mocked.post).toHaveBeenCalledWith("/findings/f1/eval-case");
    expect(result.current("f2").pending).toBe(false);

    const spy = vi.spyOn(qc, "invalidateQueries");
    await act(async () => {
      resolve({ case: { agent_id: "a1", provenance: { pr_id: "p1" } }, created: true });
    });
    await waitFor(() => expect(result.current("f1").pending).toBe(false));
    const invalidated = spy.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey));
    expect(invalidated).toContain(JSON.stringify(["reviews", "p1"]));
    expect(invalidated).toContain(JSON.stringify(["agent-eval-cases", "a1"]));
  });

  it("a refused creation exposes the error code for that finding only", async () => {
    mocked.post.mockRejectedValue(Object.assign(new Error("no diff"), { code: "eval_case_no_diff" }));
    const { wrapper } = setup();
    const { result } = renderHook(() => useFindingEvalCaseAction(), { wrapper });

    act(() => result.current("f1").onCreate());
    await waitFor(() => expect(result.current("f1").errorCode).toBe("eval_case_no_diff"));
    expect(result.current("f2").errorCode).toBeNull();
  });

  it("useAgentEvalRuns polls every 2 s only while a run is running", async () => {
    mocked.get.mockResolvedValue([{ id: "r1", status: "running" }]);
    const { qc, wrapper } = setup();
    const { result } = renderHook(() => useAgentEvalRuns("a1"), { wrapper });
    await waitFor(() => expect(result.current.data).toHaveLength(1));
    expect(mocked.get).toHaveBeenCalledWith("/agents/a1/eval-runs");

    const options = qc.getQueryCache().find({ queryKey: ["agent-eval-runs", "a1"] })!.observers[0]!
      .options as { refetchInterval: (q: unknown) => number | false };
    const at = (data: unknown) => options.refetchInterval({ state: { data } });
    expect(at([{ status: "running" }])).toBe(2000);
    expect(at([{ status: "completed" }])).toBe(false);
  });
});
