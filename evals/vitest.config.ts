import { defineConfig } from "vitest/config";
import TrendReporter from "./src/trend-reporter.js";

export default defineConfig({
  test: {
    // *.eval.ts = model-backed evals; src/**/*.test.ts and skills/**/*.test.ts = deterministic
    // unit tests (stats math, skill scripts such as the dependency-checker collector).
    include: ["**/*.eval.ts", "src/**/*.test.ts", "skills/**/*.test.ts"],
    // Real Claude sessions (and a subagent dispatch) are slow — give them room.
    testTimeout: 240_000,
    hookTimeout: 240_000,
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
