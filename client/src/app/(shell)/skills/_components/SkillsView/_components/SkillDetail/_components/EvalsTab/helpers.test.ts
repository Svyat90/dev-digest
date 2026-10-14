import { describe, it, expect } from "vitest";
import { needsAgent, skillRunBlocker } from "./helpers";

describe("skillRunBlocker", () => {
  it("names an empty set and a run in progress", () => {
    expect(skillRunBlocker([], [])).toBe("noCases");
    expect(skillRunBlocker([{}], [{ status: "completed" }, { status: "running" }])).toBe("inProgress");
    expect(skillRunBlocker([{}], [{ status: "completed" }])).toBeNull();
  });
});

describe("needsAgent", () => {
  it("is true without a remembered agent, including a deleted one", () => {
    expect(needsAgent({ agent: null, missing_agent_name: null })).toBe(true);
    expect(needsAgent({ agent: null, missing_agent_name: "Perf Reviewer" })).toBe(true);
    expect(needsAgent({ agent: { id: "a1", name: "Security Reviewer" }, missing_agent_name: null })).toBe(false);
  });
});
