// Every shipped combination, end to end from an empty folder: framework x method x facilitator mode, plus two
// special cases. Needs internet. Usage: node test/matrix.mjs   (about 3 to 5 minutes)
import assert from "node:assert/strict";
import { FRAMEWORKS, METHODS } from "../lib/variants.mjs";
import { STUB_NOTE } from "../lib/report.mjs";
import { runFlow } from "./e2e.mjs";

const rows = [];
function record(label, fn) {
  const started = Date.now();
  try {
    const line = fn();
    rows.push({ label, ok: true, line, secs: Math.round((Date.now() - started) / 1000) });
  } catch (e) {
    rows.push({ label, ok: false, line: String(e.message).split("\n")[0], secs: Math.round((Date.now() - started) / 1000) });
  }
  const r = rows.at(-1);
  console.log(`${r.ok ? "PASS" : "FAIL"}  ${label.padEnd(44)} ${String(r.secs).padStart(3)}s  ${r.line}`);
}

function expectConformant(r, { framework, method, mode }) {
  assert.equal(r.exitCode, 0, `exit code ${r.exitCode}\n${r.out}`);
  assert.equal(r.report.outcome, "conformant");
  assert.deepEqual(r.report.counts, { passed: 5, failed: 0, errored: 0, skipped: 0 });
  assert.equal(r.report.facilitator.mode, mode);
  assert.equal(r.report.project.variant.framework, framework);
  assert.equal(r.report.project.variant.method, method);
  assert.equal(r.report.wasit.version, "0.7.0");
  assert.equal(r.report.notes.includes(STUB_NOTE), mode === "stub");
  return `${r.report.counts.passed} passed, facilitator ${r.report.facilitator.mode}`;
}

for (const framework of FRAMEWORKS) {
  for (const method of METHODS) {
    record(`${framework} ${method} online (public facilitator)`, () =>
      expectConformant(runFlow({ framework, method, checkArgs: ["--online"] }), { framework, method, mode: "real" }),
    );
    record(`${framework} ${method} --offline (local stand-in)`, () =>
      expectConformant(runFlow({ framework, method, checkArgs: ["--offline"] }), { framework, method, mode: "stub" }),
    );
  }
}

record("auto fallback: probe fails, stand-in is used", () =>
  expectConformant(
    runFlow({ framework: "hono", method: "GET", env: { KIT_PROBE_URL: "http://127.0.0.1:9/supported" } }),
    { framework: "hono", method: "GET", mode: "stub" },
  ),
);

record("custom unreachable facilitator: honest failure", () => {
  const r = runFlow({ framework: "express", method: "GET", env: { FACILITATOR_URL: "http://127.0.0.1:9" } });
  assert.equal(r.exitCode, 1);
  assert.equal(r.report.outcome, "non-conformant");
  assert.equal(r.report.facilitator.mode, "custom");
  assert.equal(r.report.results[0].status, "FAIL");
  assert.match(r.out, /could not reach the facilitator/);
  return "exit 1, X402-01 FAIL, mode custom, hint printed";
});

const failed = rows.filter((r) => !r.ok);
console.log(`\n${rows.length - failed.length} of ${rows.length} scenarios passed.`);
if (failed.length) {
  for (const f of failed) console.log(`  FAILED: ${f.label}: ${f.line}`);
  process.exit(1);
}
