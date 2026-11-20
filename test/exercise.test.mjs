import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEFECTS, DEFECT_IDS, defectById } from "../lib/defects.mjs";
import { defectFromSeed, generateProject, KitError } from "../lib/generate.mjs";
import { FRAMEWORKS, mulberry32 } from "../lib/variants.mjs";
import { buildReport, exerciseStatus, renderMarkdown, renderTerminal } from "../lib/report.mjs";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "x402kit-ex-"));
const read = (dir, rel) => fs.readFileSync(path.join(dir, rel), "utf8");
const allFiles = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? allFiles(path.join(dir, e.name)) : [path.join(dir, e.name)]));
const gen = (opts) => generateProject({ name: "exercise project", seed: 11, parentDir: tmp(), ...opts });

test("catalogue integrity: unique ids, real check ids, a hint that does not give the answer away", () => {
  assert.equal(new Set(DEFECT_IDS).size, DEFECTS.length);
  for (const d of DEFECTS) {
    assert.match(d.id, /^[a-z0-9]+(-[a-z0-9]+)*$/);
    const expected = [...d.expectedFailing, ...(d.expectedUnsupported ?? [])];
    assert.ok(expected.length >= 1, `${d.id}: the defect shows in at least one check`);
    for (const c of expected) assert.match(c, /^X402-0[1-5]$/, `${d.id}: a challenge-level defect shows in X402-01 to 05`);
    if (d.expectedUnsupported) assert.equal(d.expectedFailing.length, 0, `${d.id}: an unsupported service fails no check`);
    for (const f of ["title", "hint", "explanation", "body"]) assert.ok(d[f].trim().length > 20, `${d.id}.${f}`);
    assert.ok(!d.hint.includes(d.id), `${d.id}: the hint must not contain the defect's name`);
    assert.ok(!/pubnet|mainnet|stellar:public/i.test(d.body), `${d.id}: testnet only`);
  }
});

test("an exercise project gets the defect as code, for every defect and every framework", () => {
  for (const framework of FRAMEWORKS) {
    for (const d of DEFECTS) {
      const out = gen({ framework, defect: d.id, name: `ex ${framework} ${d.id}` });
      assert.equal(out.exercise, true);
      const server = read(out.dir, "server.mjs");
      assert.ok(server.includes("function cleanUp(res)"), `${framework} ${d.id}: clean-up block present`);
      assert.ok(server.includes(d.body.split("\n")[0]), `${framework} ${d.id}: the defect's own first line is in the file`);
      const r = spawnSync(process.execPath, ["--check", path.join(out.dir, "server.mjs")], { encoding: "utf8" });
      assert.equal(r.status, 0, `${framework} ${d.id}: ${r.stderr}`);
      const project = JSON.parse(read(out.dir, "project.json"));
      assert.deepEqual(project.exercise.expectedFailing, d.expectedFailing);
      assert.equal(project.variant.defect, null, "the answer must not be in project.json's variant");
      assert.equal(JSON.parse(read(out.dir, "package.json")).scripts.exercise, "node scripts/exercise.mjs");
    }
  }
});

test("spoiler hygiene: the defect's name appears only in .exercise.json", () => {
  const out = gen({ defect: "missing-header", framework: "hono", name: "spoilers" });
  for (const f of allFiles(out.dir)) {
    const rel = path.relative(out.dir, f);
    const text = fs.readFileSync(f, "utf8");
    if (rel === ".exercise.json") {
      assert.equal(JSON.parse(text).defect, "missing-header");
    } else {
      for (const d of DEFECT_IDS) assert.ok(!text.includes(d), `${rel} mentions "${d}"`);
    }
  }
});

test("a normal project has no clean-up block, no exercise dotfile and no exercise script", () => {
  for (const framework of FRAMEWORKS) {
    const out = gen({ framework, name: `plain ${framework}` });
    assert.equal(out.exercise, false);
    assert.ok(!read(out.dir, "server.mjs").includes("cleanUp"));
    assert.ok(!fs.existsSync(path.join(out.dir, ".exercise.json")));
    assert.ok(!fs.existsSync(path.join(out.dir, "scripts/exercise.mjs")));
    assert.equal(JSON.parse(read(out.dir, "project.json")).exercise, undefined);
  }
});

test("--exercise without a named defect picks one from the seed: same seed, same defect; every defect but a by-name-only one is reachable", () => {
  const pick = (seed) => JSON.parse(read(gen({ exercise: true, seed, name: `seed ${seed}` }).dir, ".exercise.json")).defect;
  assert.equal(pick(5), pick(5));
  const seen = new Set();
  for (let seed = 0; seed < 120; seed++) seen.add(pick(seed));
  assert.deepEqual([...seen].sort(), DEFECTS.filter((d) => !d.byNameOnly).map((d) => d.id).sort());
});

test("an unknown defect is rejected", () => {
  assert.throws(() => gen({ defect: "nope" }), (e) => e instanceof KitError && e.code === "bad-option");
});

test("scripts/exercise.mjs: hint and reveal read the answer; no argument gives only usage", () => {
  const out = gen({ defect: "missing-field", name: "script test" });
  const d = defectById("missing-field");
  const run = (arg) => spawnSync(process.execPath, [path.join(out.dir, "scripts/exercise.mjs"), ...(arg ? [arg] : [])], { encoding: "utf8" }).stdout;
  assert.ok(run("--hint").includes(d.hint));
  assert.ok(run("--reveal").includes(d.explanation));
  const usage = run();
  assert.ok(!usage.includes(d.hint) && !usage.includes(d.explanation) && !usage.includes("missing-field"));
  const plain = gen({ name: "no exercise" });
  const none = spawnSync(process.execPath, [path.join(plain.dir, "scripts", "check.mjs"), "--bogus"], { encoding: "utf8" });
  assert.equal(none.status, 2); // unknown option is refused, not ignored
});

// ---- report: exercise status is computed by code from Wasit's result ----
const result = (id, status) => ({ id, name: id, status, detail: "" });
const wasitJson = (results) => ({
  outcome: results.some((r) => r.status === "FAIL") ? "non-conformant" : "conformant",
  passed: results.filter((r) => r.status === "PASS").length,
  failed: results.filter((r) => r.status === "FAIL").length,
  errored: results.filter((r) => r.status === "ERROR").length,
  skipped: results.filter((r) => r.status === "SKIP").length,
  results,
});
const common = {
  project: { name: "x", seed: 1, variant: { framework: "express", method: "GET", path: "/paid", resource: "fun-fact", price: "$0.01", network: "stellar:testnet", defect: null } },
  wasit: { version: "0.8.0-beta.1", command: "wasit test" },
  facilitator: { mode: "stub", url: "http://127.0.0.1:1" },
  kitVersion: "0.1.0",
  generatedAt: "2026-10-18T00:00:00.000Z",
  harnessError: null,
};
const allPass = ["01", "02", "03", "04", "05"].map((n) => result(`X402-${n}`, "PASS"));

test("exercise status: solved, defect-present, different, unknown, and none when there is no exercise", () => {
  const ex = { expectedFailing: ["X402-02"] };
  const present = [result("X402-01", "PASS"), result("X402-02", "FAIL"), result("X402-03", "SKIP"), result("X402-04", "SKIP"), result("X402-05", "SKIP")];
  const other = [result("X402-01", "PASS"), result("X402-02", "PASS"), result("X402-03", "PASS"), result("X402-04", "FAIL"), result("X402-05", "PASS")];
  assert.equal(buildReport({ ...common, wasitJson: wasitJson(allPass), exercise: ex }).exercise.status, "solved");
  assert.equal(buildReport({ ...common, wasitJson: wasitJson(present), exercise: ex }).exercise.status, "defect-present");
  assert.equal(buildReport({ ...common, wasitJson: wasitJson(other), exercise: ex }).exercise.status, "different");
  assert.equal(buildReport({ ...common, wasitJson: wasitJson([result("X402-01", "ERROR"), ...allPass.slice(1)]), exercise: ex }).exercise.status, "unknown");
  assert.equal(buildReport({ ...common, wasitJson: null, harnessError: "boom", exercise: ex }).exercise.status, "unknown");
  assert.equal(buildReport({ ...common, wasitJson: wasitJson(allPass) }).exercise, null);
  assert.equal(exerciseStatus(null, { results: [], counts: {}, outcome: "x" }), null);
});

test("exercise status lists what failed, and the terminal and Markdown say it without naming the defect", () => {
  const present = [result("X402-01", "PASS"), result("X402-02", "FAIL"), result("X402-03", "SKIP"), result("X402-04", "SKIP"), result("X402-05", "SKIP")];
  const r = buildReport({ ...common, wasitJson: wasitJson(present), exercise: { expectedFailing: ["X402-02"] } });
  assert.deepEqual(r.exercise.observedFailing, ["X402-02"]);
  for (const out of [renderTerminal(r), renderMarkdown(r)]) {
    assert.match(out, /Exercise/);
    assert.match(out, /same checks still fail \(X402-02\), so the defect is probably still there/);
    assert.match(out, /--hint/);
    for (const id of DEFECT_IDS) assert.ok(!out.includes(id));
  }
  const solved = buildReport({ ...common, wasitJson: wasitJson(allPass), exercise: { expectedFailing: ["X402-02"] } });
  assert.match(renderTerminal(solved), /Solved: no check fails/);
});

test("a by-name-only defect is never drawn from a seed, and every other seed keeps its defect from kit 0.1.1", () => {
  const byName = DEFECTS.filter((d) => d.byNameOnly).map((d) => d.id);
  assert.deepEqual(byName, ["v1-body"]);
  const oldDraw = (seed) => DEFECTS[Math.floor(mulberry32((seed ^ 0x9e3779b9) >>> 0)() * DEFECTS.length)];
  let kept = 0;
  for (let seed = 0; seed < 5000; seed++) {
    const d = defectFromSeed(seed);
    assert.ok(!d.byNameOnly, `seed ${seed} drew ${d.id}`);
    if (!oldDraw(seed).byNameOnly) {
      assert.equal(d.id, oldDraw(seed).id, `seed ${seed} changed its defect`);
      kept++;
    }
  }
  assert.ok(kept > 3500, `most seeds keep their defect (${kept})`);
  // Named, it is still given.
  const out = gen({ defect: "v1-body", name: "ex by name" });
  assert.equal(out.exercise, true);
  const project = JSON.parse(read(out.dir, "project.json"));
  assert.deepEqual(project.exercise, { expectedFailing: [], expectedUnsupported: ["X402-02", "X402-03", "X402-04", "X402-05"] });
});

test("an exercise that starts unsupported: present while Wasit cannot grade it, solved once it conforms", () => {
  const ex = { expectedFailing: [], expectedUnsupported: ["X402-02", "X402-03", "X402-04", "X402-05"] };
  const skipU = (id) => ({ id, name: id, status: "SKIP", skipKind: "unsupported", detail: "x402 v1 challenge" });
  const unsupportedRun = { ...wasitJson([result("X402-01", "PASS"), ...["02", "03", "04", "05"].map((n) => skipU(`X402-${n}`))]), outcome: "no-verdict" };
  const present = buildReport({ ...common, wasitJson: unsupportedRun, exercise: ex });
  assert.equal(present.exercise.status, "defect-present");
  assert.deepEqual(present.exercise.observedUnsupported, ["X402-02", "X402-03", "X402-04", "X402-05"]);
  assert.equal(present.results[1].skipKind, "unsupported");
  for (const out of [renderTerminal(present), renderMarkdown(present)]) {
    assert.match(out, /Wasit still cannot grade this service: X402-02, X402-03, X402-04, X402-05 are reported as unsupported/);
    for (const id of DEFECT_IDS) assert.ok(!out.includes(id));
  }
  assert.equal(buildReport({ ...common, wasitJson: wasitJson(allPass), exercise: ex }).exercise.status, "solved");
  const failingNow = [result("X402-01", "PASS"), result("X402-02", "FAIL"), result("X402-03", "SKIP"), result("X402-04", "SKIP"), result("X402-05", "SKIP")];
  assert.equal(buildReport({ ...common, wasitJson: wasitJson(failingNow), exercise: ex }).exercise.status, "different");
  // A skip for another reason (a dependency) is not "unsupported": no statement is made.
  const depSkips = { ...wasitJson([result("X402-01", "PASS"), ...["02", "03", "04", "05"].map((n) => ({ ...result(`X402-${n}`, "SKIP"), skipKind: "dependency" }))]), outcome: "no-verdict" };
  assert.equal(buildReport({ ...common, wasitJson: depSkips, exercise: ex }).exercise.status, "unknown");
  // An exercise that starts failing is not "present" just because checks are unsupported.
  assert.equal(buildReport({ ...common, wasitJson: unsupportedRun, exercise: { expectedFailing: ["X402-02"] } }).exercise.status, "unknown");
});
