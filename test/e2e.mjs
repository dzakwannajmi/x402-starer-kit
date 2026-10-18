// End-to-end run from an EMPTY folder, as a participant would do it. Needs internet (npm registry and the
// public testnet facilitator). Usage: node test/e2e.mjs   (or: npm run e2e)
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const kit = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "kit.mjs");
const work = fs.mkdtempSync(path.join(os.tmpdir(), "x402kit-e2e-"));
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const sh = process.platform === "win32";

function step(title, cmd, args, cwd) {
  console.log(`\n=== ${title} ===`);
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8", shell: sh, env: { ...process.env, NO_COLOR: "1" } });
  const out = `${r.stdout}${r.stderr}`.trim();
  console.log(out.split("\n").slice(-14).join("\n"));
  return r;
}

console.log("work folder:", work, "| node", process.version);

const gen = step("1. kit new", process.execPath, [kit, "new", "--name", "My First x402", "--seed", "7", "--dir", work], work);
assert.equal(gen.status, 0, "kit new failed");

const project = path.join(work, "my-first-x402");
assert.ok(fs.existsSync(path.join(project, "server.mjs")));

const inst = step("2. npm install (scripts disabled by the project's .npmrc)", npm, ["install", "--no-audit", "--no-fund"], project);
assert.equal(inst.status, 0, "npm install failed");

const check = step("3. npm run check", npm, ["run", "check", "--silent"], project);
const report = JSON.parse(fs.readFileSync(path.join(project, "report.json"), "utf8"));
console.log("\nreport.json outcome:", report.outcome, JSON.stringify(report.counts), "| wasit", report.wasit.version, "| facilitator", report.facilitator.mode);

assert.equal(check.status, 0, "npm run check did not exit 0");
assert.equal(report.outcome, "conformant");
assert.deepEqual(report.counts, { passed: 5, failed: 0, errored: 0, skipped: 0 });
assert.equal(report.project.name, "My First x402");
assert.ok(fs.existsSync(path.join(project, "report.md")));
const payee = JSON.parse(fs.readFileSync(path.join(project, "project.json"), "utf8")).payee;
assert.match(payee, /^G[A-Z2-7]{55}$/, "a public payee address should have been created");

console.log("\nE2E OK. Files kept for inspection in:", project);
