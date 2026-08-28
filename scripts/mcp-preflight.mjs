// scripts/mcp-preflight.mjs
//
// Repository-owned, fail-closed preflight for the dev-only MCP add-ons declared
// in `.mcp.json` (universal) and `.opencode/opencode.jsonc` (OpenCode-native).
//
// The two files are intentional mirrors (different consumers read different
// native formats). This script proves they stay in sync and that every declared
// server obeys the Repository-Local Add-ons Master Plan rules:
//   - launcher is repo-local/ephemeral (npx/node/bun), not a global binary path
//   - the MCP package version is pinned (semver), never `@latest`/unpinned
//   - no embedded secret-like values
//   - no unsafe non-loopback target/permission flags
//   - zero duplicate integration IDs
//   - the two mirrors do not drift
//
// It never mutates production data and never contacts protected environments.
// Exits non-zero on any violation so it can gate CI / pre-commit.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const FILES = [
  { path: resolve(root, ".mcp.json"), format: "mcpjson" },
  { path: resolve(root, ".opencode", "opencode.jsonc"), format: "opencode" },
];

const ALLOWED_LAUNCHERS = new Set(["npx", "node", "bun", "npm", "pnpm", "yarn"]);
const SEMVER_RE = /^@?[\w./-]+@\d+\.\d+\.\d+(?:[-+].+)?$/;
const PKG_SPEC_RE = /(@?[\w./-]+)@(\d+\.\d+\.\d+(?:[-+].+)?|latest)$/;
const SECRET_RE = [
  /sk-[a-z0-9]{16,}/i,
  /pk-[a-z0-9]{16,}/i,
  /api[_-]?key\s*[:=]\s*['"]?[a-z0-9]{16,}/i,
  /token\s*[:=]\s*['"]?[a-z0-9]{16,}/i,
  /bearer\s+[a-z0-9._-]{16,}/i,
  /password\s*[:=]\s*['"]?.{6,}/i,
  /secret\s*[:=]\s*['"]?.{6,}/i,
  /[a-z0-9+/]{40,}={0,2}/, // high-entropy blob
];
const UNSAFE_FLAG_RE = /^--browser-url=(.+)$/i;

function stripJsonc(text) {
  let out = "";
  let inStr = false;
  let strCh = "";
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (inStr) {
      out += c;
      if (c === "\\") {
        out += text[i + 1] ?? "";
        i += 2;
        continue;
      }
      if (c === strCh) inStr = false;
      i++;
      continue;
    }
    if (c === '"' || c === "'") {
      inStr = true;
      strCh = c;
      out += c;
      i++;
      continue;
    }
    if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

function parseServers(file) {
  let raw;
  try {
    raw = readFileSync(file.path, "utf8");
  } catch (e) {
    throw new PreflightError(`cannot read ${file.path}: ${e.message}`);
  }
  let data;
  try {
    data = JSON.parse(file.format === "opencode" ? stripJsonc(raw) : raw);
  } catch (e) {
    throw new PreflightError(`cannot parse ${file.path}: ${e.message}`);
  }
  const servers = {};
  if (file.format === "mcpjson") {
    const m = data.mcpServers;
    if (!m || typeof m !== "object") {
      throw new PreflightError(`${file.path}: missing mcpServers object`);
    }
    for (const [id, s] of Object.entries(m)) servers[id] = normalize(s);
  } else {
    const m = data.mcp;
    if (!m || typeof m !== "object") {
      throw new PreflightError(`${file.path}: missing mcp object`);
    }
    for (const [id, s] of Object.entries(m)) servers[id] = normalize(s);
  }
  return servers;
}

function normalize(s) {
  const command = String(s.command ?? "");
  const args = Array.isArray(s.args) ? s.args.map(String) : [];
  const env = s.env && typeof s.env === "object" ? s.env : {};
  return { command, args, env };
}

class PreflightError extends Error {}

const errors = [];
const warnings = [];
const seenIds = new Set();

function checkServer(id, s, fileLabel) {
  if (seenIds.has(`${fileLabel}:${id}`)) {
    errors.push(`duplicate integration id "${id}" in ${fileLabel}`);
  }
  seenIds.add(`${fileLabel}:${id}`);

  if (!ALLOWED_LAUNCHERS.has(s.command)) {
    // Allow repo-local relative/absolute script paths launched by node/bun;
    // flag bare global binaries that would resolve outside the repository.
    if (!/^[./\\]/.test(s.command) && !s.command.includes(pathSep)) {
      warnings.push(
        `${fileLabel} server "${id}": launcher "${s.command}" is not a repo-local ephemeral launcher (npx/node/bun) — verify it is not a global binary`,
      );
    }
  }
  const specs = s.args
    .map((a) => PKG_SPEC_RE.exec(a))
    .filter(Boolean)
    .map((m) => ({ name: m[1], version: m[2] }));
  const pkgSpec = specs.find(
    (sp) => sp.name.includes("chrome-devtools-mcp") || sp.name.includes("context7-mcp"),
  );
  if (!pkgSpec) {
    errors.push(
      `${fileLabel} server "${id}": no pinned MCP package spec (expected <pkg>@<semver>)`,
    );
  } else if (pkgSpec.version === "latest") {
    errors.push(
      `${fileLabel} server "${id}": package ${pkgSpec.name} pinned to @latest — must pin an exact version`,
    );
  } else if (!SEMVER_RE.test(`${pkgSpec.name}@${pkgSpec.version}`)) {
    errors.push(
      `${fileLabel} server "${id}": package ${pkgSpec.name} version "${pkgSpec.version}" is not a pinned semver`,
    );
  }

  for (const a of s.args) {
    const m = UNSAFE_FLAG_RE.exec(a);
    if (m) {
      const url = m[1];
      if (!/^(https?:\/\/)?(127\.0\.0\.1|localhost)(:|\/|$)/i.test(url)) {
        errors.push(
          `${fileLabel} server "${id}": unsafe non-loopback target "${a}"`,
        );
      }
    }
  }

  for (const [k, v] of Object.entries(s.env)) {
    if (SECRET_RE.some((re) => re.test(String(v)))) {
      errors.push(`${fileLabel} server "${id}": env ${k} looks like an embedded secret`);
    }
  }

  const haystack = JSON.stringify({ command: s.command, args: s.args, env: s.env });
  if (SECRET_RE.some((re) => re.test(haystack))) {
    errors.push(`${fileLabel} server "${id}": possible embedded secret-like value detected`);
  }
}

const pathSep = process.platform === "win32" ? "\\" : "/";

const parsed = FILES.map((f) => {
  const servers = parseServers(f);
  for (const [id, s] of Object.entries(servers)) checkServer(id, s, f.path);
  return { file: f, servers };
});

// Drift check: the two mirrors must declare the same server set with identical
// normalized command+args.
const [a, b] = parsed;
const aIds = Object.keys(a.servers).sort();
const bIds = Object.keys(b.servers).sort();
if (JSON.stringify(aIds) !== JSON.stringify(bIds)) {
  errors.push(
    `mirror drift: ${a.file.path} servers [${aIds}] != ${b.file.path} servers [${bIds}]`,
  );
} else {
  for (const id of aIds) {
    const na = JSON.stringify(a.servers[id]);
    const nb = JSON.stringify(b.servers[id]);
    if (na !== nb) {
      errors.push(`mirror drift on server "${id}" between ${a.file.path} and ${b.file.path}`);
    }
  }
}

console.log("MCP preflight — repository-local add-on governance");
console.log("=".repeat(56));
for (const { file, servers } of parsed) {
  console.log(`${file.path}`);
  for (const [id, s] of Object.entries(servers)) {
    console.log(`  - ${id}: ${s.command} ${s.args.join(" ")}`);
  }
}
console.log("=".repeat(56));

if (warnings.length) {
  console.log("Warnings:");
  for (const w of warnings) console.log(`  ! ${w}`);
}
if (errors.length) {
  console.log("FAIL — violations:");
  for (const e of errors) console.log(`  x ${e}`);
  console.log(`\n${errors.length} violation(s) detected.`);
  process.exit(1);
}
console.log("PASS — all declared MCP add-ons are repository-local, pinned, secret-free, and drift-synced.");
process.exit(0);
