// Exercise mode, end to end from empty folders: for every framework x defect, run the broken project through Wasit,
// compare what Wasit REALLY reports with the catalogue, then "fix" the project (replace server.mjs with the clean
// version) and check that the exercise becomes solved. Offline mode is used so the result does not depend on the
// public facilitator. Needs internet for npm and npx. Usage: node test/exercise-matrix.mjs   (a few minutes)
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFECTS } from "../lib/defects.mjs";
import { renderServer } from "../lib/generate.mjs";
import { FRAMEWORKS, pickVariant } from "../lib/variants.mjs";

const kit = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "kit.mjs");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const sh = process.platform === "win32";
const exec = (cmd, args, cwd) => {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8", shell: sh, env: { ...process.env, NO_COLOR: "1" } });
  return { status: r.status, out: `${r.stdout}${r.stderr}`.trim() };
};
const failing = (report) => report.results.filter((x) => x.status === "FAIL").map((x) => x.id).sort();
const summary = (report) => report.results.map((x) => `${x.id.slice(-2)}:${x.status}`).join(" ");

const rows = [];
for (const framework of FRAMEWORKS) {
  for (const d of DEFECTS) {
    const started = Date.now();
    const label = `${framework} / ${d.id}`;
    const work = fs.mkdtempSync(path.join(os.tmpdir(), "x402kit-ex-"));
    try {
      const gen = exec(process.execPath, [kit, "new", "--name", "Fix Me", "--seed", "21", "--dir", work, "--framework", framework, "--defect", d.id], work);
      assert.equal(gen.status, 0, `kit new failed: ${gen.out}`);
      assert.ok(!gen.out.includes(d.id), "kit new must not print the defect's name");
      const project = path.join(work, "fix-me");
      const inst = exec(npm, ["install", "--no-audit", "--no-fund"], project);
      assert.equal(inst.status, 0, `npm install failed: ${inst.out}`);

      // 1. the broken project
      const broken = exec(npm, ["run", "check", "--silent", "--", "--offline"], project);
      const r1 = JSON.parse(fs.readFileSync(path.join(project, "report.json"), "utf8"));
      const observed = failing(r1);
      const note = `${summary(r1)}`;
      assert.deepEqual(observed, [...d.expectedFailing].sort(), `Wasit reported ${note}`);
      assert.equal(r1.exercise.status, "defect-present");
      assert.equal(broken.status, 1, `exit code ${broken.status}`);
      assert.ok(!JSON.stringify(r1).includes(d.id), "the report must not name the defect");

      // 2. the participant fixes it (here: the clean server)
      const saved = JSON.parse(fs.readFileSync(path.join(project, "project.json"), "utf8"));
      const { resourceBody } = pickVariant(saved.seed, { framework: saved.variant.framework, method: saved.variant.method });
      fs.writeFileSync(path.join(project, "server.mjs"), renderServer({ framework, resourceBody, defect: null }));
      const fixed = exec(npm, ["run", "check", "--silent", "--", "--offline"], project);
      const r2 = JSON.parse(fs.readFileSync(path.join(project, "report.json"), "utf8"));
      assert.equal(r2.exercise.status, "solved", `after the fix: ${summary(r2)}`);
      assert.equal(r2.outcome, "conformant");
      assert.equal(fixed.status, 0);

      // 3. the answer scripts
      const reveal = exec(npm, ["run", "exercise", "--silent", "--", "--reveal"], project);
      assert.ok(reveal.out.includes(d.explanation.slice(0, 40)));
      rows.push({ label, ok: true, secs: Math.round((Date.now() - started) / 1000), line: `broken: ${note}  ->  fixed: solved` });
    } catch (e) {
      rows.push({ label, ok: false, secs: Math.round((Date.now() - started) / 1000), line: String(e.message).split("\n").slice(0, 3).join(" | ") });
    } finally {
      fs.rmSync(work, { recursive: true, force: true });
    }
    const r = rows.at(-1);
    console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.label.padEnd(30)} ${String(r.secs).padStart(3)}s  ${r.line}`);
  }
}

const bad = rows.filter((r) => !r.ok);
console.log(`\n${rows.length - bad.length} of ${rows.length} exercise scenarios passed.`);
if (bad.length) process.exit(1);
