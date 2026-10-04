import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/lib/api", () => ({
  api: { get: vi.fn(), put: vi.fn(), post: vi.fn(), patch: vi.fn(), del: vi.fn() },
}));

import { api } from "@/lib/api";
import {
  useContextDocs,
  useAgentContextDocs,
  useSetAgentContextDocs,
} from "./project-context";

const mocked = api as unknown as Record<"get" | "put", ReturnType<typeof vi.fn>>;

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  mocked.get.mockReset();
  mocked.put.mockReset();
});

describe("project-context hooks", () => {
  it("builds the docs query string with URLSearchParams", async () => {
    mocked.get.mockResolvedValue({ documents: [] });
    renderHook(() => useContextDocs("r1", "api docs"), { wrapper: wrapper() });
    await waitFor(() =>
      expect(mocked.get).toHaveBeenCalledWith("/repos/r1/context/docs?q=api+docs"),
    );
  });

  it("does not fetch until every id is present", () => {
    renderHook(() => useAgentContextDocs("a1", null), { wrapper: wrapper() });
    expect(mocked.get).not.toHaveBeenCalled();
  });

  it("PUTs the full ordered paths and refetches the agent context", async () => {
    mocked.get.mockResolvedValue({ own: [], inherited: [] });
    mocked.put.mockResolvedValue({ paths: ["docs/a.md"] });
    const { result } = renderHook(
      () => ({
        q: useAgentContextDocs("a1", "r1"),
        m: useSetAgentContextDocs("a1", "r1"),
      }),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(mocked.get).toHaveBeenCalledTimes(1));
    act(() => result.current.m.mutate(["docs/a.md"]));
    await waitFor(() =>
      expect(mocked.put).toHaveBeenCalledWith("/agents/a1/context-docs", { paths: ["docs/a.md"] }),
    );
    await waitFor(() => expect(mocked.get).toHaveBeenCalledTimes(2));
  });
});
