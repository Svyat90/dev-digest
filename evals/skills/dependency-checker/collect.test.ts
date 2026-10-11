/**
 * Deterministic tests for the dependency-checker collector (no model, no network).
 * Each run builds a two-package mini repo in a temp dir and reads the collector's JSON.
 *   pnpm vitest run skills/dependency-checker/collect.test.ts
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { EVALS_DIR, SKILLS_DIR } from "../../src/artifacts/paths.js";

const COLLECTOR = join(SKILLS_DIR, "dependency-checker", "scripts", "collect.mjs");

let root: string;
let out: any;

const write = (path: string, content: string) => {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
};
const json = (path: string, value: unknown) => write(path, JSON.stringify(value));
const fakePackage = (dir: string, manifest: Record<string, unknown>, bytes: number) => {
  json(`${dir}/package.json`, { version: "1.0.0", ...manifest });
  write(`${dir}/payload.bin`, "x".repeat(bytes));
};

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "dep-checker-"));

  // alpha: pnpm package with every kind of dependency the report ranks.
  json("alpha/package.json", {
    dependencies: { "used-dep": "^1.0.0", "string-only-dep": "^1.0.0", "unused-dep": "^1.0.0", "peer-needed": "^1.0.0", "provided-dep": "^1.0.0", zod: "^3.24.0" },
    devDependencies: { typescript: "^5.0.0" },
  });
  write("alpha/pnpm-lock.yaml", "lockfileVersion: '9.0'\n");
  json("alpha/tsconfig.json", { compilerOptions: { paths: { "@shared/*": ["../server/src/*"] } } });
  write(
    "alpha/src/index.ts",
    [
      `import used from "used-dep";`,
      `import { thing } from "@shared/thing";`,
      `import { deep } from "../../server/src/deep.js";`,
      `import ghost from "phantom-dep";`,
      // Code inside a template literal is not an import: string-only-dep is a string mention at most.
      "const sample = `\nimport only from \"string-only-dep\";\n`;",
      `export const api = "http://localhost:3001/api";`,
    ].join("\n"),
  );
  write("alpha/src/forbidden.ts", `import { z } from "zod/v4";\n`);

  fakePackage("alpha/node_modules/used-dep", { dependencies: { "provided-dep": "^1.0.0" }, peerDependencies: { "peer-needed": "*" } }, 200 * 1024);
  fakePackage("alpha/node_modules/provided-dep", {}, 100 * 1024);
  fakePackage("alpha/node_modules/peer-needed", {}, 1024);
  fakePackage("alpha/node_modules/unused-dep", {}, 1024);
  fakePackage("alpha/node_modules/string-only-dep", {}, 1024);
  // A real typescript for the import parser, linked the way pnpm links: a symlink that plain du must not follow.
  symlinkSync(join(EVALS_DIR, "node_modules", "typescript"), join(root, "alpha/node_modules/typescript"));

  // server: the target of alpha's alias, relative escape and HTTP call.
  json("server/package.json", {});
  write("server/src/deep.ts", "export const deep = 1;\n");
  write("server/src/thing.ts", "export const thing = 1;\n");

  out = JSON.parse(execFileSync("node", [COLLECTOR], { cwd: root, encoding: "utf8" }));
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

const alpha = () => out.packages.find((p: any) => p.package === "alpha");
const dep = (name: string) => alpha().dependencies.find((d: any) => d.name === name);

describe("dependency-checker collector", () => {
  test("discovers every top-level package and parses imports with typescript", () => {
    expect(out.summary.packages.map((p: any) => p.package)).toEqual(["alpha", "server"]);
    expect(alpha().importParser).toMatch(/^typescript /);
  });

  test("classifies each dependency by how it is actually used", () => {
    expect(dep("used-dep").usedBy).toBe("imports");
    expect(dep("used-dep").importedIn.src).toBe(1);
    expect(dep("unused-dep").usedBy).toBe("none-found");
    expect(dep("string-only-dep").importedIn.src).toBe(0);
    expect(dep("string-only-dep").usedBy).toMatch(/^string-mention/);
    expect(dep("peer-needed").usedBy).toBe("peer-of:used-dep");
    expect(dep("provided-dep").usedBy).toMatch(/^transitive-of:used-dep/);
  });

  test("reports alias, relative-escape and runtime-http edges separately", () => {
    const edges = alpha().internalEdges;
    expect(edges.find((e: any) => e.kind === "alias")).toMatchObject({ alias: "@shared/*", targetPackage: "server", crossPackage: true });
    expect(edges.find((e: any) => e.kind === "relative-escape")).toMatchObject({ targetPackage: "server", fromKinds: ["src"] });
    expect(edges.find((e: any) => e.kind === "runtime-http")).toMatchObject({ targetPackage: "server", ports: [3001] });
  });

  test("flags undeclared and forbidden imports", () => {
    expect(alpha().undeclaredImports.map((u: any) => u.name)).toEqual(["phantom-dep"]);
    expect(alpha().forbiddenImports[0]).toMatchObject({ specifier: "zod/v4" });
  });

  test("sizes: transitive includes dependencies, node_modules total does not follow symlinks", () => {
    expect(dep("used-dep").transitiveMb).toBeGreaterThan(dep("used-dep").ownMb);
    expect(dep("used-dep").transitivePackages).toBe(1);
    // typescript (~23 MB) is reachable only through the symlink; following it would blow this bound.
    expect(alpha().nodeModulesMb).toBeLessThan(2);
  });
});
