import { defineConfig } from "vitest/config";
import TrendReporter from "./src/trend-reporter.js";

// Per-test budget. 240 s fits the Anthropic models; slower reasoning models on OpenRouter
// (DeepSeek V4 Flash thinks before answering) need more — CI sets EVAL_TEST_TIMEOUT_MS.
const TEST_TIMEOUT_MS = Number(process.env.EVAL_TEST_TIMEOUT_MS ?? "240000");

export default defineConfig({
  test: {
    // *.eval.ts = model-backed evals; src/**/*.test.ts and skills/**/*.test.ts = deterministic
    // unit tests (stats math, skill scripts such as the dependency-checker collector).
    include: ["**/*.eval.ts", "src/**/*.test.ts", "skills/**/*.test.ts"],
    // Real Claude sessions (and a subagent dispatch) are slow — give them room.
    testTimeout: TEST_TIMEOUT_MS,
    hookTimeout: TEST_TIMEOUT_MS,
    // One session per test; a few files can run concurrently. Keep it modest to stay cheap.
    fileParallelism: true,
    // Vitest adds "github-actions" on CI only when no reporters are configured, so add it here:
    // each failed case becomes an annotation (test name + error) on the PR's Checks page.
    reporters: [
      "default",
      new TrendReporter(),
      ...(process.env.GITHUB_ACTIONS === "true" ? ["github-actions" as const] : []),
    ],
  },
});
