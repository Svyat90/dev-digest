import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/lib/api", () => ({
  api: { get: vi.fn(), put: vi.fn(), post: vi.fn(), patch: vi.fn(), del: vi.fn() },
}));

import { api } from "@/lib/api";
import { usePrBrief, useGenerateBrief } from "./brief";

const mocked = api as unknown as Record<"get" | "post", ReturnType<typeof vi.fn>>;

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

const brief = (summary: string) => ({ summary, head_sha: "abc" });

beforeEach(() => {
  mocked.get.mockReset();
  mocked.post.mockReset();
});

describe("brief hooks", () => {
  it("usePrBrief(null) makes no request", () => {
    renderHook(() => usePrBrief(null), { wrapper: wrapper() });
    expect(mocked.get).not.toHaveBeenCalled();
  });

  it("reads the stored brief with GET and never generates on its own", async () => {
    mocked.get.mockResolvedValue(brief("old"));
    const { result } = renderHook(() => usePrBrief("p1"), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.data).toEqual(brief("old")));
    expect(mocked.get).toHaveBeenCalledWith("/pulls/p1/brief");
    expect(mocked.post).not.toHaveBeenCalled();
  });

  it("a failed generation keeps the cached brief; a successful one replaces it", async () => {
    mocked.get.mockResolvedValue(brief("old"));
    const { result } = renderHook(
      () => ({ q: usePrBrief("p1"), m: useGenerateBrief("p1") }),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.q.data).toEqual(brief("old")));

    mocked.post.mockRejectedValueOnce(Object.assign(new Error("x"), { code: "invalid_model_answer" }));
    act(() => result.current.m.mutate());
    await waitFor(() => expect(result.current.m.isError).toBe(true));
    expect(result.current.q.data).toEqual(brief("old"));

    mocked.post.mockResolvedValueOnce(brief("new"));
    act(() => result.current.m.mutate());
    await waitFor(() => expect(result.current.q.data).toEqual(brief("new")));
    expect(mocked.post).toHaveBeenCalledWith("/pulls/p1/brief");
  });
});
