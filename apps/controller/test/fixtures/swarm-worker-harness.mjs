import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const packetId = process.env.ORCA_PACKET_ID || "unknown-packet";
const workstream = process.env.ORCA_WORKSTREAM || packetId;
const failPacket = process.env.ORCA_SWARM_FAIL_PACKET || "";
const slowMs = Number(process.env.ORCA_SWARM_HARNESS_SLOW_MS || "0");
const waitFile = process.env.ORCA_SWARM_WAIT_FILE || "";

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

let allowedPaths = [];
try {
  const parsed = JSON.parse(process.env.ORCA_ALLOWED_PATHS || "[]");
  if (Array.isArray(parsed)) allowedPaths = parsed.filter((value) => typeof value === "string");
} catch {}

const relativePath = allowedPaths[0] || `.orca/swarm/${packetId}.txt`;
const target = path.join(process.cwd(), relativePath);
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, `swarm worker ${workstream} (${packetId})\n`);
execFileSync("git", ["add", "--", relativePath], { cwd: process.cwd(), stdio: "inherit" });
execFileSync("git", ["commit", "-m", `swarm worker ${workstream}`], { cwd: process.cwd(), stdio: "inherit" });
