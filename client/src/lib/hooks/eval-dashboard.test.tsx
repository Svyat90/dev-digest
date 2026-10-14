import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/lib/api", () => ({
  api: { get: vi.fn(), put: vi.fn(), post: vi.fn(), patch: vi.fn(), del: vi.fn() },
}));

import { api } from "@/lib/api";
import {
  useRunAllEvals,
  usePromoteEvalRun,
  useEvalRunComparison,
  useAgentEvalDashboard,
} from "./eval-dashboard";

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

describe("eval dashboard hooks", () => {
  it("run-all posts with no body", async () => {
    mocked.post.mockResolvedValue({ started: [], skipped: [] });
    const { wrapper } = setup();
    const { result } = renderHook(() => useRunAllEvals(), { wrapper });
    result.current.mutate();
    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith("/eval-dashboard/run-all"));
  });

  it("promote posts to the run's promote path and invalidates restored skills", async () => {
    mocked.post.mockResolvedValue({
      agent_id: "a1",
      agent_version: 3,
      run_agent_version: 1,
      restored_skills: [{ skill_id: "s1", version: 2 }],
    });
    const { qc, wrapper } = setup();
    const spy = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => usePromoteEvalRun("a1"), { wrapper });
    result.current.mutate("r1");
    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith("/agents/a1/eval-runs/r1/promote"));
    await waitFor(() => {
      const keysSeen = spy.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey));
      expect(keysSeen).toContain(JSON.stringify(["skill-versions", "s1"]));
    });
  });

  it("comparison sends nothing without two run ids", () => {
    const { wrapper } = setup();
    renderHook(() => useEvalRunComparison("a1", null), { wrapper });
    expect(mocked.get).not.toHaveBeenCalled();
  });

  it("agent dashboard refetches while a run is running", async () => {
    mocked.get.mockResolvedValue({ running_run: { id: "r" }, runs: [] });
    const { wrapper } = setup();
    const { result } = renderHook(() => useAgentEvalDashboard("a1", "30d"), { wrapper });
    await waitFor(() => expect(result.current.data).toBeTruthy());
    expect(mocked.get).toHaveBeenCalledWith("/agents/a1/eval-dashboard?range=30d");
  });
});
