import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const packetId = process.env.ORCA_PACKET_ID || "unknown-packet";
const workstream = process.env.ORCA_WORKSTREAM || packetId;
const failPacket = process.env.ORCA_SWARM_FAIL_PACKET || "";
const slowMs = Number(process.env.ORCA_SWARM_HARNESS_SLOW_MS || "0");
const waitFile = process.env.ORCA_SWARM_WAIT_FILE || "";
const requireFile = process.env.ORCA_REQUIRE_FILE || "";
const requireContent = process.env.ORCA_REQUIRE_CONTENT || "";
const requirePackets = (process.env.ORCA_REQUIRE_PACKETS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

if (slowMs > 0) {
  await new Promise((resolve) => setTimeout(resolve, slowMs));
}

if (waitFile) {
  while (!fs.existsSync(waitFile)) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

if (failPacket === packetId || failPacket === workstream) {
  fs.writeFileSync(path.join(process.cwd(), `${workstream}-failed.txt`), "intentional worker failure\n");
  process.exit(17);
}

// Dependency-state mode: this worker cannot succeed unless the required
// upstream file has been materialized into its worktree base with the
// expected content. Used to prove real DAG dependency state, not just ordering.
function dependencyFailure(message) {
  const markerDir = path.join(process.cwd(), ".orca");
  fs.mkdirSync(markerDir, { recursive: true });
  fs.writeFileSync(path.join(markerDir, `dependency-failure-${packetId}.txt`), message + "\n");
  process.exit(31);
}

let derivedFrom = "";
const requirementApplies =
  requirePackets.length === 0 ||
  requirePackets.includes(packetId) ||
  requirePackets.includes(workstream);
if (requireFile && requirementApplies) {
  const depPath = path.join(process.cwd(), requireFile);
  if (!fs.existsSync(depPath)) {
    dependencyFailure(`required dependency input missing: ${requireFile}`);
  }
  const depContent = fs.readFileSync(depPath, "utf8");
  if (requireContent && !depContent.includes(requireContent)) {
    dependencyFailure(`dependency input ${requireFile} does not contain expected content: ${requireContent}`);
  }
  derivedFrom = depContent;
}

let allowedPaths = [];
try {
  const parsed = JSON.parse(process.env.ORCA_ALLOWED_PATHS || "[]");
  if (Array.isArray(parsed)) allowedPaths = parsed.filter((value) => typeof value === "string");
} catch {}

const relativePath = allowedPaths[0] || `.orca/swarm/${packetId}.txt`;
const target = path.join(process.cwd(), relativePath);
fs.mkdirSync(path.dirname(target), { recursive: true });
const ownOutput = `swarm worker ${workstream} (${packetId})\n`;
fs.writeFileSync(target, derivedFrom ? ownOutput + `derived-from:\n${derivedFrom}` : ownOutput);
// allowedPaths-enforcement seam: optionally also write+stage a file outside
// the declared scope so qualification tests can prove real enforcement.
if (process.env.ORCA_SWARM_VIOLATE_PATHS === "1") {
  const extraRel = `.orca/swarm/${packetId}-outside-scope.txt`;
  const extraPath = path.join(process.cwd(), extraRel);
  fs.mkdirSync(path.dirname(extraPath), { recursive: true });
  fs.writeFileSync(extraPath, `outside allowedPaths (${packetId})\n`);
  execFileSync("git", ["add", "--", extraRel], { cwd: process.cwd(), stdio: "inherit" });
}
execFileSync("git", ["add", "--", relativePath], { cwd: process.cwd(), stdio: "inherit" });
execFileSync("git", ["commit", "-m", `swarm worker ${workstream}`], { cwd: process.cwd(), stdio: "inherit" });
