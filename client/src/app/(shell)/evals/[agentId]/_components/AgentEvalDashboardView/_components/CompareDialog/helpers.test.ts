import { describe, it, expect } from "vitest";
import evalMessages from "@messages/en/eval.json";
import { promoteConfirmBody, type Translate } from "./helpers";

// Minimal interpolation over the real bundle: enough for plain {name} messages.
const t: Translate = (key, values = {}) => {
  const path = key.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], evalMessages);
  return String(path).replace(/\{(\w+)\}/g, (_, k: string) => String(values[k]));
};

describe("promoteConfirmBody", () => {
  it("lists replaced version, restores, affected agents and deleted skills", () => {
    const body = promoteConfirmBody(
      {
        run_id: "r",
        run_agent_version: 7,
        current_agent_version: 9,
        is_current: false,
        skills_to_restore: [{ skill_id: "s1", name: "Security", current_version: 4, recorded_version: 2 }],
        affected_agents: [{ id: "a2", name: "Performance Reviewer" }],
        deleted_skills: [{ skill_id: "s2", name: "Old" }],
      },
      t,
    );
    const lines = body.split("\n");
    expect(lines).toHaveLength(4);
    expect(lines[0]).toContain("v9");
    expect(lines[1]).toBe("Skill Security: v4 gets the body of v2");
    expect(lines[2]).toContain("Performance Reviewer");
    expect(lines[3]).toBe("Old: deleted — left out");
  });
});
