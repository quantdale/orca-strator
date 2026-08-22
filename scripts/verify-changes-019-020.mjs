/**
 * Post-restart verification for OpenSpec changes 019 + 020 (Orca-Strator).
 *
 * Run from repo root after restarting OpenCode (the session that authored
 * these changes had its shell bridge broken, so nothing here has executed
 * yet):
 *
 *   node scripts/verify-changes-019-020.mjs
 *
 * Sequence: focused new tests -> controller fast tier -> shared/UI checks ->
 * typecheck -> build -> lint -> strict OpenSpec validation -> git diff --check.
 * Fails fast; prints a PASS/FAIL line per step. Exit code 0 = all green.
 */

import { spawnSync } from "node:child_process";
import process from "node:process";

const steps = [
  {
    name: "focused: change 019/020 new tests",
    cmd: [
      "npx",
      "vitest",
      "run",
      "apps/controller/test/executor-start-serialization.test.ts",
      "apps/controller/test/usage-scheduler.test.ts",
      "apps/controller/test/permission-resolution-flow.test.ts",
      "apps/ui/src/components/OperationalIntelligencePanel.test.tsx",
    ],
  },
  { name: "fast tier: npm test", cmd: ["npm", "test"] },
  { name: "typecheck", cmd: ["npm", "run", "typecheck"] },
  { name: "build", cmd: ["npm", "run", "build"] },
  { name: "lint", cmd: ["npm", "run", "lint"] },
  {
    name: "openspec strict validation",
    cmd: ["npx", "openspec", "validate", "--all", "--strict"],
  },
  { name: "git diff --check", cmd: ["git", "diff", "--check"] },
];

let failed = 0;
for (const step of steps) {
  console.log(`\n=== ${step.name} ===`);
  const result = spawnSync(step.cmd[0], step.cmd.slice(1), {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  const ok = result.status === 0;
  console.log(`[${ok ? "PASS" : "FAIL"}] ${step.name}`);
  if (!ok) {
    failed++;
    break;
  }
}

console.log(
  failed === 0
    ? "\nALL GATES GREEN — proceed to fold/archive 019+020, tick remaining test tasks, update waypoint, commit/push."
    : `\n${failed} gate(s) FAILED — fix before folding/archiving.`,
);
process.exit(failed === 0 ? 0 : 1);
