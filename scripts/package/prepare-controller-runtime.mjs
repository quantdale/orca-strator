#!/usr/bin/env node
/**
 * Change 025 task 1.3/1.4: stage the packaged controller runtime.
 *
 * Produces apps/desktop/resources/{controller,ui} containing:
 *  - compiled controller dist + minimal ESM package.json
 *  - an exact-version production dependency closure (from root package-lock)
 *    including the built @orca/shared workspace package
 *  - the built React UI
 *
 * Runtime data (DB, profiles, logs) is NEVER staged here; packaged resources
 * are immutable by contract.
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const desktopDir = path.join(repoRoot, "apps", "desktop");
const staging = path.join(desktopDir, "resources");
const controllerPkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "apps", "controller", "package.json"), "utf8"));
const sharedPkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "packages", "shared", "package.json"), "utf8"));
const appPkg = JSON.parse(fs.readFileSync(path.join(desktopDir, "package.json"), "utf8"));

function rmrf(p) {
  fs.rmSync(p, { recursive: true, force: true });
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else if (entry.isFile()) fs.copyFileSync(s, d);
  }
}

// ---- Resolve exact versions + transitive closure from the root lockfile ----

const lock = JSON.parse(fs.readFileSync(path.join(repoRoot, "package-lock.json"), "utf8"));
if (!lock.packages || !lock.packages["node_modules/fastify"]) {
  console.error("[prepare] Root package-lock.json is missing or has no workspace deps installed. Run npm install first.");
  process.exit(1);
}

function resolveClosure(rootDeps) {
  const closure = new Map();
  const queue = [...rootDeps];
  while (queue.length > 0) {
    const name = queue.shift();
    if (!name || closure.has(name)) continue;
    const key = `node_modules/${name}`;
    const entry = lock.packages[key];
    if (!entry || !entry.version) {
      console.error(`[prepare] ${name} is not present in the root package-lock.json`);
      process.exit(1);
    }
    closure.set(name, entry.version);
    for (const depType of ["dependencies", "optionalDependencies"]) {
      for (const dep of Object.keys(entry[depType] ?? {})) queue.push(dep);
    }
  }
  return closure;
}

const prodDeps = resolveClosure(Object.keys(controllerPkg.dependencies ?? {}).filter((d) => d !== "@orca/shared"));

console.log(`[prepare] Staging ${prodDeps.size} production dependencies (exact lockfile versions).`);

const tmpInstall = path.join(staging, ".deps-install");
rmrf(tmpInstall);
fs.mkdirSync(tmpInstall, { recursive: true });
const tmpPkg = { name: "orca-controller-runtime-deps", version: "0.0.0", private: true, dependencies: {} };
for (const [name, version] of [...prodDeps].sort(([a], [b]) => a.localeCompare(b))) {
  tmpPkg.dependencies[name] = version;
}
fs.writeFileSync(path.join(tmpInstall, "package.json"), JSON.stringify(tmpPkg, null, 2));

execFileSync("npm", ["install", "--omit=dev", "--no-audit", "--no-fund", "--ignore-scripts"], {
  cwd: tmpInstall,
  stdio: "inherit",
  shell: process.platform === "win32"
});

// ---- Assemble staging layout ----

const controllerStage = path.join(staging, "controller");
rmrf(controllerStage);
copyDir(path.join(repoRoot, "apps", "controller", "dist"), path.join(controllerStage, "dist"));

fs.writeFileSync(
  path.join(controllerStage, "package.json"),
  JSON.stringify(
    {
      name: controllerPkg.name,
      version: appPkg.version,
      type: "module",
      main: "dist/index.js",
      private: true
    },
    null,
    2
  )
);

fs.mkdirSync(path.join(controllerStage, "node_modules"), { recursive: true });

// @orca/shared built output + manifest
const sharedStage = path.join(controllerStage, "node_modules", "@orca", "shared");
fs.mkdirSync(sharedStage, { recursive: true });
copyDir(path.join(repoRoot, "packages", "shared", "dist"), path.join(sharedStage, "dist"));
fs.writeFileSync(
  path.join(sharedStage, "package.json"),
  JSON.stringify(
    {
      name: sharedPkg.name,
      version: appPkg.version,
      type: sharedPkg.type ?? "module",
      main: sharedPkg.main ?? "dist/index.js",
      types: sharedPkg.types ?? "dist/index.d.ts",
      private: true
    },
    null,
    2
  )
);

// Third-party production closure from the isolated install
const installedModules = path.join(tmpInstall, "node_modules");
for (const name of prodDeps.keys()) {
  const src = path.join(installedModules, ...name.split("/"));
  const dest = path.join(controllerStage, "node_modules", ...name.split("/"));
  if (!fs.existsSync(src)) {
    // Scoped packages may live under their scope dir with nested layout only
    // when hoisting differs; a missing module is fatal for runtime integrity.
    console.error(`[prepare] Expected dependency ${name} was not installed into the staging prefix.`);
    process.exit(1);
  }
  rmrf(dest);
  copyDir(src, dest);
}
rmrf(tmpInstall);

// Built UI
const uiStage = path.join(staging, "ui");
rmrf(uiStage);
copyDir(path.join(repoRoot, "apps", "ui", "dist"), uiStage);

console.log(`[prepare] Controller runtime staged at ${staging}`);
