import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { buildReport, renderMarkdown, renderTerminal, maskSecrets, mdEscape, DISCLAIMER } from "../lib/report.mjs";

const fixture = (n) => JSON.parse(fs.readFileSync(new URL(`./fixtures/${n}.json`, import.meta.url), "utf8"));

const project = {
  name: "My First x402",
  seed: 42,
  variant: { framework: "express", resource: "fun-fact", price: "$0.01", network: "stellar:testnet", defect: null },
};
const common = {
  project,
  wasit: { version: "0.7.0", command: "wasit test --target http://127.0.0.1:1/paid --read-only --json" },
  facilitator: { mode: "real", url: "https://www.x402.org/facilitator" },
  kitVersion: "0.1.0",
  generatedAt: "2026-10-18T12:00:00.000Z",
  harnessError: null,
};

test("a conformant Wasit run is copied as it is", () => {
  const r = buildReport({ ...common, wasitJson: fixture("wasit-conformant") });
  assert.equal(r.outcome, "conformant");
  assert.deepEqual(r.counts, { passed: 5, failed: 0, errored: 0, skipped: 0 });
  assert.equal(r.results.length, 5);
  assert.ok(r.results.every((x) => x.status === "PASS"));
  assert.equal(r.kind, "generated-demo-project");
  assert.equal(r.disclaimer, DISCLAIMER);
  assert.equal(r.exercise, null);
});

test("a failing Wasit run keeps every status exactly (no softening)", () => {
  const w = fixture("wasit-nonconformant");
  const r = buildReport({ ...common, wasitJson: w });
  assert.equal(r.outcome, "non-conformant");
  assert.deepEqual(
    r.results.map((x) => `${x.id}:${x.status}`),
    w.results.map((x) => `${x.id}:${x.status}`),
  );
  assert.equal(r.counts.failed, w.failed);
});

test("unreadable Wasit output becomes a harness error with NO invented results", () => {
  const r = buildReport({ ...common, wasitJson: null, harnessError: "boom" });
  assert.equal(r.outcome, "harness-error");
  assert.deepEqual(r.results, []);
  assert.deepEqual(r.counts, { passed: 0, failed: 0, errored: 0, skipped: 0 });
  assert.match(r.error, /boom/);
});

test("an unknown status is not trusted: harness error, not a guess", () => {
  const bad = { outcome: "conformant", passed: 1, failed: 0, errored: 0, skipped: 0, results: [{ id: "X402-01", name: "x", status: "MAYBE", detail: "" }] };
  assert.equal(buildReport({ ...common, wasitJson: bad }).outcome, "harness-error");
});

test("64-hex values and Stellar secrets are masked everywhere", () => {
  const hash = "98a59fc50fedc0e5832b15635c68384cac62c18fa6a72cc90d3febd8b2f31a48";
  const secret = "S" + "A".repeat(55);
  assert.equal(maskSecrets(`tx ${hash}`), "tx 98a59f...1a48");
  assert.equal(maskSecrets(`tx 0x${hash}`), "tx 0x98a59f...1a48");
  assert.equal(maskSecrets(secret), "S<masked>");
  const w = fixture("wasit-conformant");
  w.results[5 - 1].detail = `settled in tx ${hash} using ${secret}`;
  const r = buildReport({ ...common, wasitJson: w });
  const all = JSON.stringify(r) + renderTerminal(r) + renderMarkdown(r);
  assert.ok(!all.includes(hash));
  assert.ok(!all.includes(secret));
});

test("the participant's name is exact in JSON and escaped in Markdown", () => {
  const nasty = { ...project, name: "**bold** [x](http://e.com) | <b>" };
  const r = buildReport({ ...common, project: nasty, wasitJson: fixture("wasit-conformant") });
  assert.equal(JSON.parse(JSON.stringify(r)).project.name, nasty.name);
  const md = renderMarkdown(r);
  assert.ok(md.includes("\\*\\*bold\\*\\*"));
  assert.ok(!md.includes("[x](http://e.com)"));
  assert.equal(mdEscape("a|b"), "a\\|b");
});

test("terminal block and Markdown carry the disclaimer and name the facilitator mode", () => {
  const r = buildReport({ ...common, wasitJson: fixture("wasit-conformant") });
  for (const out of [renderTerminal(r), renderMarkdown(r)]) {
    assert.ok(out.includes(r.disclaimer));
    assert.match(out, /facilitator/i);
  }
  assert.match(renderTerminal(r), /Result\s+conformant: 5 passed/);
});

test("the kit speaks English only: no Bahasa Indonesia strings in any output", () => {
  const r = buildReport({ ...common, wasitJson: fixture("wasit-nonconformant") });
  const all = renderTerminal(r) + renderMarkdown(r) + JSON.stringify(r);
  assert.ok(!/\b(Hasil|Catatan|lulus|gagal|dilewati|sesuai|Ringkasan|Pengecekan|Perintah)\b/.test(all));
  assert.equal(r.disclaimerId, undefined);
});

test("Wasit's summary numbers must match its own rows, otherwise nothing is trusted", () => {
  const w = fixture("wasit-conformant");
  const ok = buildReport({ ...common, wasitJson: w });
  assert.equal(ok.outcome, "conformant");
  // Numbers that say 0 passed next to five PASS rows, and a missing number, both give a harness error, never a report.
  for (const bad of [{ ...w, passed: 0 }, { ...w, passed: undefined }, { ...w, failed: 1 }, { ...w, skipped: 2 }]) {
    const r = buildReport({ ...common, wasitJson: bad });
    assert.equal(r.outcome, "harness-error");
    assert.deepEqual(r.results, []);
    assert.match(r.error, /do not match/);
  }
});
