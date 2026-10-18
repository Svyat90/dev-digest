#!/usr/bin/env node
// Collects dependency facts for every DevDigest package and prints ONE JSON document.
// Read-only: it never installs, edits or deletes anything. No third-party imports.
//
//   node .claude/skills/dependency-checker/scripts/collect.mjs [--summary] [pkg ...]   (run from the repo root)
//
// Packages are discovered as the top-level directories that hold a package.json.
// --summary drops the per-file detail and keeps what the report needs.
// Every number the report quotes (MB, shares, counts) is computed here, not by the model.

import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { builtinModules, createRequire } from "node:module";
import { dirname, join, relative, resolve, sep } from "node:path";

const ROOT = process.cwd();
const args = process.argv.slice(2);
const SUMMARY = args.includes("--summary");
const requested = args.filter((a) => !a.startsWith("--"));

const SKIP_DIRS = new Set(["node_modules", ".next", ".next-e2e", "dist", "clones", "test-results", ".git", "coverage", "fixtures", "results"]);
const SRC_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts|css)$/;
const BUILTINS = new Set(builtinModules);

// Ports from root CLAUDE.md: a `localhost:<port>` URL in one package's source is a runtime edge to another.
const PORTS = { 3001: "server", 3000: "client", 3101: "server", 3100: "client" };

// Imports that the repo rules forbid (see root CLAUDE.md and INSIGHTS.md).
const FORBIDDEN = [
  { re: /^zod\/(v4|mini)/, why: "Zod 4 API; the repo is pinned to Zod 3" },
  { re: /^@zod\//, why: "Zod 4 ecosystem package; the repo is pinned to Zod 3" },
  { re: /^@modelcontextprotocol\/(server|client)$/, why: "MCP SDK v2 hard-depends on Zod 4; use @modelcontextprotocol/sdk v1" },
];

// Dev tools that are run by name or configured implicitly, so "no import found" proves nothing.
const TOOLING = new Set(["typescript", "tsx", "vitest", "drizzle-kit", "dependency-cruiser", "tailwindcss", "postcss", "@tailwindcss/postcss", "esbuild"]);

// Dependencies whose size is the point of the package; never ranked as "oversized".
const CORE = new Set(["next", "react", "react-dom", "fastify", "drizzle-orm", "typescript"]);

// First match wins. Keep categories coarse: they group the report, they do not judge.
const CATEGORIES = [
  ["types", /^@types\//],
  ["testing", /^(vitest|jsdom|@testing-library\/|testcontainers$|@testcontainers\/|@vitest\/|msw$|agent-browser)/],
  ["build-tooling", /^(typescript|tsx|esbuild|postcss|@tailwindcss\/postcss|tailwindcss|dependency-cruiser|drizzle-kit|@vitejs\/|vite$)/],
  ["framework", /^(next|react|react-dom|fastify|@fastify\/)$|^@fastify\//],
  ["database", /^(drizzle-orm|pg|postgres|pgvector|@electric-sql\/)/],
  ["llm-ai", /^(openai|@anthropic-ai\/|js-tiktoken|@modelcontextprotocol\/)/],
  ["validation", /^(zod|@sinclair\/typebox|ajv)/],
  ["ui", /^(lucide-react|recharts|mermaid|@tanstack\/|clsx|class-variance-authority|tailwind-merge|@radix-ui\/)/],
  ["logging", /^(pino|pino-pretty)$/],
];
const categoryOf = (name) => (CATEGORIES.find(([, re]) => re.test(name)) ?? ["other"])[0];

const readJson = (p) => {
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return null;
  }
};
const toMb = (kb) => (kb == null ? null : Math.round((kb / 1024) * 10) / 10);

function discoverPackages() {
  return readdirSync(ROOT)
    .filter((d) => !d.startsWith(".") && d !== "node_modules" && existsSync(join(ROOT, d, "package.json")))
    .sort();
}
const ALL_PACKAGES = discoverPackages();
const packages = requested.length ? requested : ALL_PACKAGES;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(full, out);
    else if (SRC_EXT.test(name)) out.push(full);
  }
  return out;
}

// "@scope/name/sub/path" -> "@scope/name"; "name/sub" -> "name"
function packageOf(spec) {
  const parts = spec.split("/");
  return spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

// Where a file's imports count: shipped code, tests, or package-level config/scripts.
function fileKind(pkgDir, file) {
  const rel = relative(pkgDir, file);
  if (/(^|\/)(test|tests|__tests__)\//.test(rel) || /\.(test|spec|it\.test)\.[cm]?[jt]sx?$/.test(rel)) return "test";
  if (!rel.includes(sep) || rel.startsWith(`scripts${sep}`)) return "config";
  return "src";
}

// Real import specifiers. TypeScript's scanner skips imports inside strings and template
// literals; the regex fallback (no typescript installed) does not.
function makeScanner(pkgDir) {
  let ts = null;
  try {
    ts = createRequire(join(pkgDir, "package.json"))("typescript");
  } catch {}
  const FALLBACK = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+)["']([^"']+)["']/gm;
  const CSS = /@(?:import|plugin|config)\s+(?:url\()?["']([^"']+)["']/g;
  const MOCK = /\bvi\.mock\(\s*["']([^"'.][^"']*)["']/g;
  return {
    parser: ts ? `typescript ${ts.version}` : "regex (typescript not installed)",
    scan(file, text) {
      if (file.endsWith(".css")) return [...text.matchAll(CSS)].map((m) => m[1]);
      const specs = ts ? ts.preProcessFile(text, true, true).importedFiles.map((f) => f.fileName) : [...text.matchAll(FALLBACK)].map((m) => m[1]);
      return [...specs, ...[...text.matchAll(MOCK)].map((m) => m[1])];
    },
  };
}

// On-disk size of one package directory, without its nested node_modules (counted as their own packages).
const dirSizeCache = new Map();
function ownDirKb(dir) {
  if (dirSizeCache.has(dir)) return dirSizeCache.get(dir);
  let blocks = 0;
  const seen = new Set();
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    let entries;
    try {
      entries = readdirSync(d);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (d !== dir || name !== "node_modules") {
        const full = join(d, name);
        let st;
        try {
          st = lstatSync(full);
        } catch {
          continue;
        }
        if (st.isSymbolicLink()) continue;
        if (st.isDirectory()) {
          if (name !== "node_modules") stack.push(full);
          continue;
        }
        const key = `${st.dev}:${st.ino}`;
        if (seen.has(key)) continue;
        seen.add(key);
        blocks += st.blocks;
      }
    }
  }
  const kb = Math.round((blocks * 512) / 1024);
  dirSizeCache.set(dir, kb);
  return kb;
}

// Node's lookup: <from>/node_modules/<name>, then each parent directory.
function resolvePackageDir(fromDir, name) {
  let dir = fromDir;
  for (;;) {
    const candidate = join(dir, "node_modules", ...name.split("/"));
    if (existsSync(join(candidate, "package.json"))) return realpathSync(candidate);
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

// Own size plus every runtime dependency reachable from it (dependencies + optionalDependencies), each counted once.
function transitive(rootDir) {
  const seen = new Set([rootDir]);
  const queue = [rootDir];
  while (queue.length) {
    const dir = queue.pop();
    const m = readJson(join(dir, "package.json")) ?? {};
    for (const name of Object.keys({ ...m.dependencies, ...m.optionalDependencies })) {
      const dep = resolvePackageDir(dir, name);
      if (dep && !seen.has(dep)) {
        seen.add(dep);
        queue.push(dep);
      }
    }
  }
  let kb = 0;
  for (const d of seen) kb += ownDirKb(d);
  return { kb, packages: seen.size - 1 };
}

function duKb(path) {
  try {
    // Plain du, never -L: -L re-counts pnpm's top-level symlinks into node_modules/.pnpm.
    return Number(execFileSync("du", ["-sk", path], { encoding: "utf8" }).split(/\s+/)[0]);
  } catch {
    return null;
  }
}

function report(pkg) {
  const dir = resolve(ROOT, pkg);
  const manifest = readJson(join(dir, "package.json"));
  if (!manifest) return { package: pkg, error: "package.json not found" };

  const nmDir = join(dir, "node_modules");
  const installed = existsSync(nmDir);
  const manager = existsSync(join(dir, "pnpm-lock.yaml")) ? "pnpm" : existsSync(join(dir, "package-lock.json")) ? "npm" : "unknown";

  const sections = ["dependencies", "devDependencies", "peerDependencies"];
  const declared = new Set(sections.flatMap((k) => Object.keys(manifest[k] ?? {})));

  const tsconfig = readJson(join(dir, "tsconfig.json"));
  // An alias that just redirects a declared npm package (reviewer-core maps "zod") is not an internal edge.
  const aliases = Object.entries(tsconfig?.compilerOptions?.paths ?? {})
    .map(([alias, targets]) => ({ alias, target: targets[0] }))
    .filter((a) => !declared.has(a.alias.replace(/\/\*$/, "")));

  const scanner = makeScanner(dir);
  const files = walk(dir);
  const usage = new Map(); // npm name -> {src,test,config,vendored, files:Set}
  const undeclared = new Map();
  const forbidden = [];
  const internal = new Map();
  const runtime = new Map();
  const mentionedAsString = new Set();
  const scriptsText = Object.values(manifest.scripts ?? {}).join("\n");

  const bump = (map, name, kind, rel) => {
    if (!map.has(name)) map.set(name, { src: 0, test: 0, config: 0, vendored: 0, files: new Set() });
    const u = map.get(name);
    if (!u.files.has(rel)) {
      u.files.add(rel);
      u[kind]++;
      if (rel.includes(`${sep}vendor${sep}`)) u.vendored++;
    }
  };

  for (const file of files) {
    const rel = relative(ROOT, file);
    const kind = fileKind(dir, file);
    const text = readFileSync(file, "utf8");
    for (const n of declared) if (text.includes(`"${n}"`) || text.includes(`'${n}'`)) mentionedAsString.add(n);
    // A URL in a test or fixture does not make the package need the other one running.
    for (const m of kind === "test" ? [] : text.matchAll(/(?:https?:\/\/)?(?:localhost|127\.0\.0\.1):(\d{4})\b/g)) {
      const target = PORTS[m[1]];
      if (target && target !== pkg) {
        if (!runtime.has(target)) runtime.set(target, { kind: "runtime-http", targetPackage: target, crossPackage: true, ports: new Set(), fromKinds: new Set(), files: new Set() });
        runtime.get(target).ports.add(Number(m[1]));
        runtime.get(target).fromKinds.add(kind);
        runtime.get(target).files.add(rel);
      }
    }
    for (const spec of scanner.scan(file, text)) {
      if (spec.startsWith(".")) {
        const target = relative(ROOT, resolve(file, "..", spec));
        const top = target.split(sep)[0];
        if (top !== pkg && ALL_PACKAGES.includes(top)) {
          const key = `relative-escape|${target}`;
          if (!internal.has(key)) internal.set(key, { kind: "relative-escape", targetPackage: top, crossPackage: true, specifier: spec, fromKinds: new Set(), files: new Set() });
          internal.get(key).files.add(rel);
          internal.get(key).fromKinds.add(kind);
        }
        continue;
      }
      const alias = aliases.find((a) => (a.alias.endsWith("/*") ? spec.startsWith(a.alias.slice(0, -1)) : spec === a.alias));
      if (alias) {
        const top = relative(ROOT, resolve(dir, alias.target.replace(/\/\*$/, ""))).split(sep)[0];
        const targetPackage = ALL_PACKAGES.includes(top) ? top : pkg;
        const key = `alias|${alias.alias}`;
        if (!internal.has(key)) internal.set(key, { kind: "alias", alias: alias.alias, targetPackage, crossPackage: targetPackage !== pkg, fromKinds: new Set(), files: new Set() });
        internal.get(key).files.add(rel);
        internal.get(key).fromKinds.add(kind);
        continue;
      }
      if (spec.startsWith("node:") || BUILTINS.has(spec) || BUILTINS.has(packageOf(spec)) || /^[a-z]+:/.test(spec)) continue;
      const name = packageOf(spec);
      for (const f of FORBIDDEN) if (f.re.test(spec)) forbidden.push({ specifier: spec, file: rel, why: f.why });
      if (declared.has(name)) bump(usage, name, kind, rel);
      else if (!declared.has(`@types/${name}`)) bump(undeclared, name, kind, rel);
    }
  }

  // Installed manifests of the declared deps, to find peers and transitive providers.
  const installedManifests = new Map();
  for (const name of declared) {
    const d = installed ? resolvePackageDir(dir, name) : null;
    installedManifests.set(name, d ? { dir: d, manifest: readJson(join(d, "package.json")) } : null);
  }
  const peerOf = (name) => [...installedManifests].filter(([n, v]) => n !== name && v?.manifest?.peerDependencies?.[name]).map(([n]) => n);
  const providedBy = (name) => [...installedManifests].filter(([n, v]) => n !== name && v?.manifest?.dependencies?.[name]).map(([n]) => n);

  const describe = (name, range, section) => {
    const inst = installedManifests.get(name);
    const u = usage.get(name);
    const typesOf = name.startsWith("@types/") ? usage.get(name.slice(7)) : null;
    const inScripts = new RegExp(`(^|[\\s;&|/])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([\\s;&|]|$)`).test(scriptsText);
    const peers = peerOf(name);
    const providers = providedBy(name);
    let usedBy;
    if (u) usedBy = "imports";
    else if (typesOf) usedBy = "types-of-imported-package";
    else if (name.startsWith("@types/") || TOOLING.has(name)) usedBy = "tooling (implicit)";
    else if (inScripts) usedBy = "package.json scripts";
    else if (peers.length) usedBy = `peer-of:${peers.join(",")}`;
    else if (mentionedAsString.has(name)) usedBy = "string-mention (config/transport; verify)";
    else if (providers.length) usedBy = `transitive-of:${providers.join(",")} (direct declaration redundant?)`;
    else usedBy = "none-found";
    const own = inst ? ownDirKb(inst.dir) : null;
    const trans = inst ? transitive(inst.dir) : null;
    return {
      name,
      section,
      category: categoryOf(name),
      core: CORE.has(name),
      declared: range,
      installedVersion: inst?.manifest?.version ?? null,
      ownMb: toMb(own),
      transitiveMb: toMb(trans?.kb ?? null),
      transitivePackages: trans?.packages ?? null,
      importedIn: u ? { src: u.src, test: u.test, config: u.config, vendored: u.vendored } : { src: 0, test: 0, config: 0, vendored: 0 },
      // A runtime dependency that only tests or config import belongs in devDependencies.
      onlyOutsideSrc: section === "dependencies" && !!u && u.src === 0,
      sampleFiles: u ? [...u.files].slice(0, 3) : [],
      usedBy,
    };
  };

  const deps = sections
    .flatMap((s) => Object.entries(manifest[s] ?? {}).map(([n, r]) => describe(n, r, s)))
    .sort((a, b) => (b.transitiveMb ?? -1) - (a.transitiveMb ?? -1));

  const count = (s) => deps.filter((d) => d.section === s).length;
  const serialize = (m) => [...m.values()].map((e) => ({ ...e, ...(e.fromKinds ? { fromKinds: [...e.fromKinds] } : {}), ...(e.ports ? { ports: [...e.ports] } : {}), files: e.files.size, sampleFiles: [...e.files].slice(0, 3) }));

  return {
    package: pkg,
    manager,
    importParser: scanner.parser,
    nodeModulesInstalled: installed,
    nodeModulesMb: installed ? toMb(duKb(nmDir)) : null,
    counts: { dependencies: count("dependencies"), devDependencies: count("devDependencies"), peerDependencies: count("peerDependencies") },
    sourceFilesScanned: files.length,
    aliases,
    internalEdges: [...serialize(internal), ...serialize(runtime)],
    forbiddenImports: forbidden,
    undeclaredImports: [...undeclared].map(([name, u]) => ({ name, src: u.src, test: u.test, config: u.config, sampleFiles: [...u.files].slice(0, 3) })),
    dependencies: deps,
  };
}

const packagesReport = packages.map(report);

// Same dependency declared in several packages with different installed versions.
const byName = new Map();
for (const p of packagesReport) {
  for (const d of p.dependencies ?? []) {
    if (!byName.has(d.name)) byName.set(d.name, []);
    byName.get(d.name).push({ package: p.package, section: d.section, declared: d.declared, installedVersion: d.installedVersion });
  }
}
const versionDrift = [...byName.entries()]
  .filter(([, rows]) => rows.length > 1 && new Set(rows.map((r) => r.installedVersion ?? r.declared)).size > 1)
  .map(([name, rows]) => ({ name, rows }));
const duplicates = [...byName.entries()]
  .filter(([, rows]) => rows.length > 1)
  .map(([name, rows]) => ({ name, packages: rows.map((r) => r.package), sameVersion: new Set(rows.map((r) => r.installedVersion)).size === 1 }));

const totalMb = Math.round(packagesReport.reduce((s, p) => s + (p.nodeModulesMb ?? 0), 0) * 10) / 10;
const summary = {
  totalNodeModulesMb: totalMb,
  packages: packagesReport.map((p) => ({
    package: p.package,
    manager: p.manager,
    nodeModulesMb: p.nodeModulesMb,
    sharePct: p.nodeModulesMb == null || !totalMb ? null : Math.round((p.nodeModulesMb / totalMb) * 1000) / 10,
    ...p.counts,
    sourceFilesScanned: p.sourceFilesScanned,
    installed: p.nodeModulesInstalled,
  })),
  topByTransitiveSize: packagesReport
    .flatMap((p) => (p.dependencies ?? []).map((d) => ({ package: p.package, ...d })))
    .filter((d) => d.transitiveMb != null)
    .sort((a, b) => b.transitiveMb - a.transitiveMb)
    .slice(0, 10)
    .map(({ package: pkg, name, section, category, core, installedVersion, ownMb, transitiveMb, transitivePackages, importedIn }) => ({ package: pkg, name, section, category, core, installedVersion, ownMb, transitiveMb, transitivePackages, importedIn })),
};

// Only what can become a finding; the full per-dependency list stays in the default output.
const flagged = (d) => !["imports", "types-of-imported-package", "tooling (implicit)", "package.json scripts"].includes(d.usedBy) || d.onlyOutsideSrc;
const out = SUMMARY
  ? {
      generatedAt: new Date().toISOString(),
      summary,
      packages: packagesReport.map((p) => ({
        package: p.package,
        importParser: p.importParser,
        internalEdges: p.internalEdges,
        forbiddenImports: p.forbiddenImports,
        undeclaredImports: p.undeclaredImports,
        flaggedDependencies: (p.dependencies ?? []).filter(flagged),
      })),
      versionDrift,
      duplicates,
    }
  : { generatedAt: new Date().toISOString(), root: ROOT, summary, packages: packagesReport, versionDrift, duplicates };

console.log(JSON.stringify(out, null, 2));
