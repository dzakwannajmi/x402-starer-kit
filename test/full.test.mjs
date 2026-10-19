import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { TESTNET_USDC_ISSUER, checkPayerReady, ensureFullPayee, parsePrice, payerHelp } from "../lib/full.mjs";
import { buildReport, maskSecrets, FULL_NOTE, FULL_UNPAID_NOTE, READONLY_NOTE } from "../lib/report.mjs";
import { checkName } from "../lib/names.mjs";
import { exerciseStatus } from "../lib/report.mjs";
import { generateProject } from "../lib/generate.mjs";

const PUB = "GCWG7X3ZEXAMPLEEXAMPLEEXAMPLEEXAMPLEEXAMPLEEXAMPLEEXAMPLEXTKPB2";
const status = (balance) => [
  {
    role: "x402",
    configured: true,
    publicKey: PUB,
    status: { exists: true, balances: balance === null ? [] : [{ code: "USDC", issuer: TESTNET_USDC_ISSUER, balance }] },
  },
];

test("parsePrice reads the kit's money strings only", () => {
  assert.equal(parsePrice("$0.001"), 0.001);
  assert.equal(parsePrice("$1"), 1);
  assert.throws(() => parsePrice("1 USDC"));
  assert.throws(() => parsePrice("$-1"));
});

test("checkPayerReady covers every state", () => {
  assert.equal(checkPayerReady([{ role: "x402", configured: false }], 0.01).reason, "not-configured");
  assert.equal(checkPayerReady(null, 0.01).reason, "not-configured");
  assert.equal(checkPayerReady([{ role: "x402", configured: true, publicKey: PUB, status: { exists: false } }], 0.01).reason, "no-account");
  assert.equal(checkPayerReady(status(null), 0.01).reason, "no-usdc");
  assert.equal(checkPayerReady(status("0.0000000"), 0.01).reason, "no-usdc");
  assert.equal(checkPayerReady(status("0.005"), 0.01).reason, "low-usdc");
  const ok = checkPayerReady(status("18.5"), 0.01);
  assert.equal(ok.ok, true);
  assert.equal(ok.publicKey, PUB);
  // a USDC from another issuer does not count
  const other = [{ role: "x402", configured: true, publicKey: PUB, status: { exists: true, balances: [{ code: "USDC", issuer: "GOTHER", balance: "99" }] } }];
  assert.equal(checkPayerReady(other, 0.01).reason, "no-usdc");
});

test("payerHelp gives next steps and never prints key material", () => {
  for (const reason of ["not-configured", "no-account", "no-usdc", "low-usdc"]) {
    const text = payerHelp({ reason, publicKey: PUB, balance: 0.001 }, { price: "$0.01", wasitCommand: "npx -y @wasit-dev/cli@0.7.0" });
    assert.match(text, /wasit-dev\/cli@0\.7\.0|faucet\.circle\.com/);
    assert.ok(!/S[A-Z2-7]{55}/.test(text));
  }
});

function fakeStellar({ existing = null, neverAppears = false } = {}) {
  const calls = { friendbot: 0, submitted: 0 };
  class Server {
    async loadAccount(id) {
      if (existing && id === existing.id) return { balances: existing.balances };
      if (neverAppears) throw new Error("not found");
      return { balances: [] };
    }
    async submitTransaction() {
      calls.submitted++;
    }
  }
  class TB {
    addOperation() {
      return this;
    }
    setTimeout() {
      return this;
    }
    build() {
      return { sign() {} };
    }
  }
  return {
    calls,
    stellar: {
      Keypair: { random: () => ({ publicKey: () => "GNEWPAYEE", secret: () => "SHOULD-NEVER-BE-READ" }) },
      Horizon: { Server },
      TransactionBuilder: TB,
      Operation: { changeTrust: () => ({}) },
      Asset: class {},
      Networks: { TESTNET: "x" },
      BASE_FEE: "100",
    },
  };
}

test("ensureFullPayee creates a payee and stores only the public address", async () => {
  const { stellar, calls } = fakeStellar();
  const project = { name: "x" };
  let saved = null;
  const r = await ensureFullPayee({
    project,
    stellar,
    fetchImpl: async () => {
      calls.friendbot++;
      return { ok: true, status: 200 };
    },
    save: (p) => (saved = JSON.stringify(p)),
    sleep: async () => {},
  });
  assert.deepEqual(r, { payee: "GNEWPAYEE", created: true });
  assert.equal(calls.friendbot, 1);
  assert.equal(calls.submitted, 1);
  assert.ok(saved.includes("GNEWPAYEE"));
  assert.ok(!saved.includes("SHOULD-NEVER-BE-READ"));
});

test("ensureFullPayee reuses a payee that already trusts USDC", async () => {
  const { stellar, calls } = fakeStellar({ existing: { id: "GOLD", balances: [{ asset_code: "USDC", asset_issuer: TESTNET_USDC_ISSUER }] } });
  const r = await ensureFullPayee({
    project: { fullPayee: "GOLD" },
    stellar,
    fetchImpl: async () => {
      calls.friendbot++;
      return { ok: true };
    },
    save() {
      throw new Error("must not save");
    },
    sleep: async () => {},
  });
  assert.deepEqual(r, { payee: "GOLD", created: false });
  assert.equal(calls.friendbot, 0);
});

test("ensureFullPayee reports a Friendbot failure plainly", async () => {
  const { stellar } = fakeStellar();
  await assert.rejects(
    ensureFullPayee({ project: {}, stellar, fetchImpl: async () => ({ ok: false, status: 503 }), save() {}, sleep: async () => {} }),
    /Friendbot.*503/,
  );
});

test("ensureFullPayee gives up when the new account never appears", async () => {
  const { stellar } = fakeStellar({ neverAppears: true });
  await assert.rejects(
    ensureFullPayee({ project: {}, stellar, fetchImpl: async () => ({ ok: true }), save() {}, sleep: async () => {} }),
    /did not appear/,
  );
});

test("a full report says full mode and carries the full note", () => {
  const wasitJson = JSON.parse(fs.readFileSync(new URL("./fixtures/wasit-conformant.json", import.meta.url), "utf8"));
  const r = buildReport({
    project: { name: "n", seed: 1, variant: {} },
    wasit: { version: "0.7.0", command: "wasit test" },
    facilitator: { mode: "real", url: "u" },
    kitVersion: "1",
    generatedAt: "2026-10-18T00:00:00Z",
    wasitJson,
    harnessError: null,
    exercise: null,
    full: true,
  });
  assert.equal(r.wasit.mode, "full");
  // no X402-06 row in this fixture: the report must not claim a payment
  assert.deepEqual(r.notes, [FULL_UNPAID_NOTE]);
  const paid = { ...wasitJson, results: [...wasitJson.results, { id: "X402-06", name: "n", status: "PASS", detail: "d" }] };
  const r2 = buildReport({ ...base(wasitJson), wasitJson: paid, full: true });
  assert.deepEqual(r2.notes, [FULL_NOTE]);
  const harness = buildReport({ ...base(wasitJson), wasitJson: null, harnessError: "x", full: true });
  assert.deepEqual(harness.notes, []);
  const ro = buildReport({ ...base(wasitJson), full: false });
  assert.deepEqual(ro.notes, [READONLY_NOTE]);
});

function base(wasitJson) {
  return {
    project: { name: "n", seed: 1, variant: {} },
    wasit: { version: "0.7.0", command: "wasit test" },
    facilitator: { mode: "real", url: "u" },
    kitVersion: "1",
    generatedAt: "2026-10-19T00:00:00Z",
    wasitJson,
    harnessError: null,
    exercise: null,
  };
}

test("payer status with an error row is its own case, with Wasit's text", () => {
  const row = [{ role: "x402", configured: true, error: "Invalid secret key" }];
  const r = checkPayerReady(row, 0.01);
  assert.equal(r.reason, "status-error");
  const text = payerHelp(r, { price: "$0.01", wasitCommand: "w" });
  assert.match(text, /Invalid secret key/);
  assert.ok(!/undefined/.test(text));
});

test("a payer needs at least twice the price", () => {
  assert.equal(checkPayerReady(status("0.015"), 0.01).reason, "low-usdc");
  assert.equal(checkPayerReady(status("0.02"), 0.01).ok, true);
});

test("maskSecrets catches keys glued to a word and long hex runs", () => {
  const key = "S" + "A".repeat(55);
  assert.ok(!maskSecrets(`embed_${key}`).includes(key));
  assert.ok(!maskSecrets(key).includes(key));
  const hex128 = "ab".repeat(64);
  assert.ok(!maskSecrets(`x${hex128}`.replace("x", " ")).includes(hex128));
});

test("a project name that looks like a key is rejected", () => {
  assert.equal(checkName("S" + "A".repeat(55)).reason, "secret-like");
  assert.equal(checkName("ab".repeat(32)).reason, "secret-like");
  assert.equal(checkName("My App").ok, true);
  assert.equal(checkName("a\u061cb").display, "ab");
});

test("exercise is only solved when Wasit says conformant and the expected checks pass", () => {
  const rep = (outcome, results) => ({ outcome, counts: { errored: 0 }, results });
  const ex = { expectedFailing: ["X402-02"] };
  assert.equal(exerciseStatus(ex, rep("conformant", [{ id: "X402-02", status: "PASS" }])).status, "solved");
  assert.equal(exerciseStatus(ex, rep("conformant", [])).status, "unknown");
  assert.equal(exerciseStatus(ex, rep("no-verdict", [{ id: "X402-02", status: "SKIP" }])).status, "unknown");
});

test("generated projects ignore .env, ship scripts/full.mjs and a check:full script", () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "kit-full-"));
  try {
    const g = generateProject({ name: "Full Test", seed: 3, parentDir: parent });
    assert.match(fs.readFileSync(path.join(g.dir, ".gitignore"), "utf8"), /^\.env$/m);
    assert.ok(fs.existsSync(path.join(g.dir, "scripts", "full.mjs")));
    const pkg = JSON.parse(fs.readFileSync(path.join(g.dir, "package.json"), "utf8"));
    assert.equal(pkg.scripts["check:full"], "node scripts/check.mjs --full");
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test("the feedback link opens a new issue with the title and the questions filled in, and carries no secret", async () => {
  const { buildFeedbackUrl, FEEDBACK_BODY, FEEDBACK_REPO } = await import("../lib/feedback.mjs");
  const url = new URL(buildFeedbackUrl());
  assert.equal(url.origin + url.pathname, `https://github.com/${FEEDBACK_REPO}/issues/new`);
  assert.match(url.searchParams.get("title"), /^User feedback \(workshop kit\)/);
  const body = url.searchParams.get("body");
  assert.equal(body, FEEDBACK_BODY);
  for (const h of ["## What did you try?", "## What happened?", "## What was confusing or slow?", "## What would you like Wasit or the kit to do next?", "## Consent"]) {
    assert.ok(body.includes(h), h);
  }
  assert.match(body, /^Kind: workshop \(practice kit, generated project\)/);
  assert.ok(buildFeedbackUrl().length < 6000, "stay well under GitHub's address length limit");
  assert.ok(!/S[A-Z2-7]{55}|[0-9a-fA-F]{64}/.test(buildFeedbackUrl()));
});

test("generated projects ship the feedback script, and the run summary points to it", () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "kit-fb-"));
  try {
    const g = generateProject({ name: "Feedback Test", seed: 4, parentDir: parent });
    assert.ok(fs.existsSync(path.join(g.dir, "scripts", "feedback.mjs")));
    assert.ok(fs.existsSync(path.join(g.dir, "scripts", "feedback-lib.mjs")));
    const pkg = JSON.parse(fs.readFileSync(path.join(g.dir, "package.json"), "utf8"));
    assert.equal(pkg.scripts.feedback, "node scripts/feedback.mjs");
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});
