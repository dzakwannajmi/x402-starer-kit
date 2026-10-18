// End-to-end run from an EMPTY folder, as a participant would do it. Needs internet (npm registry; the public
// testnet facilitator unless --offline). Usage:
//   node test/e2e.mjs [--framework express|hono] [--method GET|POST] [--offline]
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const kit = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "kit.mjs");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const sh = process.platform === "win32";

function exec(cmd, args, cwd, env = {}) {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8", shell: sh, env: { ...process.env, NO_COLOR: "1", ...env } });
  return { status: r.status, out: `${r.stdout}${r.stderr}`.trim() };
}

/**
 * One full participant flow. Returns { report, project, exitCode, out }.
 * checkArgs: extra args after `npm run check --`. env: extra environment for `npm run check`.
 */
export function runFlow({ framework, method, checkArgs = [], env = {}, name = "My First x402", seed = 7, keep = false }) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "x402kit-e2e-"));
  const slug = "my-first-x402";
  const newArgs = [kit, "new", "--name", name, "--seed", String(seed), "--dir", work];
  if (framework) newArgs.push("--framework", framework);
  if (method) newArgs.push("--method", method);
  const gen = exec(process.execPath, newArgs, work);
  assert.equal(gen.status, 0, `kit new failed: ${gen.out}`);
  const project = path.join(work, slug);

  const inst = exec(npm, ["install", "--no-audit", "--no-fund"], project);
  assert.equal(inst.status, 0, `npm install failed: ${inst.out}`);
  assert.ok(!/Conflicting peer|ERESOLVE/.test(inst.out), `npm install printed peer-dependency conflicts:\n${inst.out}`);

  const check = exec(npm, ["run", "check", "--silent", ...(checkArgs.length ? ["--", ...checkArgs] : [])], project, env);
  const report = JSON.parse(fs.readFileSync(path.join(project, "report.json"), "utf8"));
  const result = { report, project, exitCode: check.status, out: check.out, work };
  if (!keep) fs.rmSync(work, { recursive: true, force: true });
  return result;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { framework: { type: "string" }, method: { type: "string" }, offline: { type: "boolean" } } });
  console.log("node", process.version);
  const r = runFlow({ framework: values.framework, method: values.method, checkArgs: values.offline ? ["--offline"] : [], keep: true });
  console.log(r.out);
  console.log("\nreport.json:", r.report.outcome, JSON.stringify(r.report.counts), "| wasit", r.report.wasit.version, "| facilitator", r.report.facilitator.mode);
  assert.equal(r.exitCode, 0, "npm run check did not exit 0");
  assert.equal(r.report.outcome, "conformant");
  assert.deepEqual(r.report.counts, { passed: 5, failed: 0, errored: 0, skipped: 0 });
  assert.equal(r.report.project.name, "My First x402");
  assert.ok(fs.existsSync(path.join(r.project, "report.md")));
  assert.match(JSON.parse(fs.readFileSync(path.join(r.project, "project.json"), "utf8")).payee, /^G[A-Z2-7]{55}$/);
  console.log("\nE2E OK. Files kept in:", r.project);
}
