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

function fakeStellar({ existing = null, neverAppears = false, quote = null, swapFails = false } = {}) {
  const calls = { friendbot: 0, submitted: 0, swapSubmitted: 0, ops: [] };
  class Server {
    strictSendPaths() {
      return { call: async () => ({ records: quote ? [{ destination_amount: quote, path: [] }] : [] }) };
    }
    async loadAccount(id) {
      if (existing && id === existing.id) return { balances: existing.balances };
      if (neverAppears) throw new Error("not found");
      return { balances: [] };
    }
    async submitTransaction(tx) {
      calls.submitted++;
      if (tx.withSwap) {
        calls.swapSubmitted++;
        if (swapFails) throw new Error("op_under_dest_min");
      }
    }
  }
  class TB {
    constructor() {
      this.withSwap = false;
    }
    addOperation(op) {
      if (op && op.swap) this.withSwap = true;
      return this;
    }
    setTimeout() {
      return this;
    }
    build() {
      return { sign() {}, withSwap: this.withSwap };
    }
  }
  return {
    calls,
    stellar: {
      Keypair: { random: () => ({ publicKey: () => "GNEWPAYEE", secret: () => "SHOULD-NEVER-BE-READ" }) },
      Horizon: { Server },
      TransactionBuilder: TB,
      Operation: { changeTrust: () => ({}), pathPaymentStrictSend: () => ({ swap: true }) },
      Asset: Object.assign(class {}, { native: () => ({ native: true }) }),
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

test("the feedback link opens a new issue with the title and the questions in place, and nothing to delete", async () => {
  const { buildFeedbackUrl, FEEDBACK_BODY, FEEDBACK_REPO } = await import("../lib/feedback.mjs");
  const url = new URL(buildFeedbackUrl());
  assert.equal(url.origin + url.pathname, `https://github.com/${FEEDBACK_REPO}/issues/new`);
  assert.match(url.searchParams.get("title"), /^User feedback \(workshop kit\)/);
  const body = url.searchParams.get("body");
  assert.equal(body, FEEDBACK_BODY);
  for (const h of ["## What did you try?", "## What happened?", "## What was confusing or slow?", "## What would you like Wasit or the kit to do next?", "## Consent"]) {
    assert.ok(body.includes(h), h);
  }
  // no instructions to delete: no intro paragraph, no hidden comments, no "paste here" placeholders
  assert.ok(!/<!--|Thank you for trying|Please write this yourself|paste the whole|leave this empty/i.test(body));
  assert.ok(!/S[A-Z2-7]{55}|[0-9a-fA-F]{64}/.test(buildFeedbackUrl()));
});

test("the report summaries are filled in from the participant's own reports, and the address stays short", async () => {
  const { buildFeedbackUrl, buildFeedbackBody, summarizeReport } = await import("../lib/feedback.mjs");
  const mk = (mode, n, extra = []) => ({
    wasit: { mode, version: "0.7.0" },
    generatedAt: "2026-10-19T12:00:00Z",
    outcome: "conformant",
    counts: { passed: n, failed: 0, errored: 0, skipped: 0 },
    results: [...Array.from({ length: n }, (_, i) => ({ id: `X402-${String(i + 1).padStart(2, "0")}`, name: `Check ${i + 1}`, status: "PASS", detail: "ok" })), ...extra],
  });
  const ro = mk("read-only", 5);
  const full = mk("full", 10);
  full.results[5].detail = "settled on-chain for exactly 50000 base units (tx 1a2c53...8ced)";
  const body = buildFeedbackBody({ readOnly: ro, full });
  assert.match(body, /My report \(npm run check\)/);
  assert.match(body, /My report \(npm run check:full\)/);
  assert.match(body, /Result: conformant: 10 passed/);
  assert.match(body, /X402-06: settled on-chain/); // the payment proof is kept
  assert.ok(!/<!--/.test(body));
  assert.equal(summarizeReport(null), "");
  assert.ok(buildFeedbackUrl({ readOnly: ro, full }).length < 6500);
  // an oversized report is trimmed, never sent as an address that is too long
  const huge = mk("full", 10);
  huge.results[5].detail = "x".repeat(20000);
  assert.ok(buildFeedbackUrl({ readOnly: ro, full: huge }).length <= 6500);
  // no reports: still a usable form
  assert.ok(!/<details>/.test(buildFeedbackBody()));
});

test("the feedback example is marked as an example and carries no secret", async () => {
  const { FEEDBACK_EXAMPLE } = await import("../lib/feedback.mjs");
  assert.match(FEEDBACK_EXAMPLE, /^EXAMPLE \(not real feedback\)/);
  assert.ok(!/S[A-Z2-7]{55}|[0-9a-fA-F]{64}/.test(FEEDBACK_EXAMPLE));
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

test("a full report has its own title", async () => {
  const { renderMarkdown } = await import("../lib/report.mjs");
  const wasitJson = JSON.parse(fs.readFileSync(new URL("./fixtures/wasit-conformant.json", import.meta.url), "utf8"));
  const mk = (full) => renderMarkdown(buildReport({ ...base(wasitJson), full }));
  assert.match(mk(true), /^# Full payment report: /);
  assert.match(mk(false), /^# Check report: /);
});

test("next steps: the question is only asked after a conformant read-only run in a terminal", async () => {
  const { parseYesNo, shouldAsk, nextStepsText, TEXT } = await import("../lib/nextsteps.mjs");
  assert.equal(parseYesNo(" Yes "), true);
  assert.equal(parseYesNo("N"), false);
  assert.equal(parseYesNo("maybe"), null);
  assert.equal(parseYesNo(undefined), null);
  const ok = { full: false, outcome: "conformant", exerciseUnsolved: false, interactive: true };
  assert.equal(shouldAsk(ok), true);
  assert.equal(shouldAsk({ ...ok, interactive: false }), false);
  assert.equal(shouldAsk({ ...ok, full: true }), false);
  assert.equal(shouldAsk({ ...ok, outcome: "non-conformant" }), false);
  assert.equal(shouldAsk({ ...ok, exerciseUnsolved: true }), false);

  const base = { full: false, outcome: "conformant", exerciseUnsolved: false };
  assert.equal(nextStepsText({ ...base, answeredYes: true }), TEXT.runFull);
  assert.equal(nextStepsText({ ...base, answeredYes: false }), TEXT.runFeedback);
  assert.equal(nextStepsText(base), TEXT.both);
  assert.equal(nextStepsText({ ...base, full: true }), TEXT.runFeedback);
  assert.equal(nextStepsText({ ...base, outcome: "non-conformant" }), null);
  assert.equal(nextStepsText({ ...base, exerciseUnsolved: true }), null);
  assert.match(TEXT.runFull, /npm run check:full/);
  assert.match(TEXT.runFeedback, /npm run feedback/);
});

test("createPayer makes a funded payer, hands the secret only to writeEnv, and returns the public address", async () => {
  const { createPayer, payerCreatedText } = await import("../lib/full.mjs");
  const { stellar, calls } = fakeStellar();
  let written = null;
  const r = await createPayer({
    stellar,
    fetchImpl: async () => {
      calls.friendbot++;
      return { ok: true, status: 200 };
    },
    writeEnv: (secret) => (written = secret),
    sleep: async () => {},
  });
  assert.deepEqual(r, { publicKey: "GNEWPAYEE", swapped: false, usdcBalance: 0 });
  assert.equal(written, "SHOULD-NEVER-BE-READ"); // the secret reached writeEnv only
  assert.equal(calls.friendbot, 1);
  assert.equal(calls.submitted, 1); // the trustline
  const text = payerCreatedText(r.publicKey);
  assert.ok(text.includes("GNEWPAYEE") && text.includes("faucet.circle.com") && !text.includes("SHOULD-NEVER-BE-READ"));
});

test("createPayer leaves nothing behind when funding fails", async () => {
  const { createPayer } = await import("../lib/full.mjs");
  const { stellar } = fakeStellar();
  let written = false;
  await assert.rejects(
    createPayer({ stellar, fetchImpl: async () => ({ ok: false, status: 503 }), writeEnv: () => (written = true), sleep: async () => {} }),
    /Friendbot.*503/,
  );
  assert.equal(written, false);
  const { stellar: s2 } = fakeStellar({ neverAppears: true });
  await assert.rejects(createPayer({ stellar: s2, fetchImpl: async () => ({ ok: true }), writeEnv: () => (written = true), sleep: async () => {} }), /did not appear/);
  assert.equal(written, false);
});

test("the faucet help skips the trustline step when the payer already has one", () => {
  const withLine = checkPayerReady(status("0.0000000"), 0.01);
  assert.equal(withLine.reason, "no-usdc");
  assert.equal(withLine.hasTrustline, true);
  const helpWith = payerHelp(withLine, { price: "$0.01", wasitCommand: "w" });
  assert.ok(!/trustline/.test(helpWith) && /1\. Open https:\/\/faucet\.circle\.com/.test(helpWith));
  const noLine = checkPayerReady(status(null), 0.01);
  assert.equal(noLine.hasTrustline, false);
  assert.match(payerHelp(noLine, { price: "$0.01", wasitCommand: "w" }), /trustline/);
});

test("generated projects pin axios to a patched version through overrides", () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "kit-ax-"));
  try {
    for (const framework of ["express", "hono"]) {
      const g = generateProject({ name: `Axios ${framework}`, seed: 6, parentDir: parent, framework });
      const pkg = JSON.parse(fs.readFileSync(path.join(g.dir, "package.json"), "utf8"));
      assert.equal(pkg.overrides.axios, "1.20.0");
    }
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test("createPayer swaps test XLM for USDC when the exchange has a price, so no faucet is needed", async () => {
  const { createPayer, payerCreatedText } = await import("../lib/full.mjs");
  const { stellar, calls } = fakeStellar({ quote: "8.8" });
  let written = null;
  const r = await createPayer({ stellar, fetchImpl: async () => ({ ok: true, status: 200 }), writeEnv: (s) => (written = s), sleep: async () => {} });
  assert.equal(r.swapped, true);
  assert.equal(calls.swapSubmitted, 1);
  assert.equal(calls.submitted, 1); // trustline and swap in one transaction
  assert.equal(written, "SHOULD-NEVER-BE-READ");
  const text = payerCreatedText(r.publicKey, { swapped: true, usdcBalance: 8.8 });
  assert.match(text, /swapped 10 test XLM/);
  assert.ok(!/faucet\.circle\.com|SHOULD-NEVER-BE-READ/.test(text));
});

test("createPayer falls back to the faucet steps when there is no price or the swap fails", async () => {
  const { createPayer, payerCreatedText } = await import("../lib/full.mjs");
  for (const opts of [{ quote: null }, { quote: "8.8", swapFails: true }, { quote: "0.2" }]) {
    const { stellar, calls } = fakeStellar(opts);
    let written = null;
    const r = await createPayer({ stellar, fetchImpl: async () => ({ ok: true, status: 200 }), writeEnv: (s) => (written = s), sleep: async () => {} });
    assert.equal(r.swapped, false, JSON.stringify(opts));
    assert.equal(written, "SHOULD-NEVER-BE-READ");
    assert.ok(calls.submitted >= 1);
    assert.match(payerCreatedText(r.publicKey, r), /faucet\.circle\.com/);
  }
});

test("next steps: a payer that already holds USDC goes straight to the full check", async () => {
  const { nextStepsText, TEXT } = await import("../lib/nextsteps.mjs");
  const base = { full: false, outcome: "conformant", exerciseUnsolved: false, answeredYes: true };
  assert.equal(nextStepsText({ ...base, payerReady: true }), TEXT.runFullNow);
  assert.equal(nextStepsText({ ...base, payerReady: false }), TEXT.runFull);
  assert.ok(!/After you have test USDC/.test(TEXT.runFullNow));
});

test("run time is shown in UTC and in the three Indonesian zones", async () => {
  const { formatRunTime } = await import("../lib/report.mjs");
  assert.equal(formatRunTime("2026-10-19T13:32:36.628Z"), "2026-10-19 13:32 UTC (20:32 WIB, 21:32 WITA, 22:32 WIT)");
  assert.equal(formatRunTime("2026-10-19T20:05:00Z"), "2026-10-19 20:05 UTC (03:05 WIB, 04:05 WITA, 05:05 WIT)");
  assert.equal(formatRunTime("not a time"), "");
});

test("the payment proof comes from Wasit's own X402-06 text, with the full hash and Stellar Expert links", async () => {
  const { extractPayment, buildReport, renderMarkdown } = await import("../lib/report.mjs");
  const { buildFeedbackBody } = await import("../lib/feedback.mjs");
  const hash = "804d6d" + "a".repeat(54) + "044c";
  const payee = "GAPKSGHHOUKC6PSHP7E6FAG6UB7D243BJ262F7F64TDSSKDW7YVN75UM";
  const payer = "GCP4DXPV3P26OJEEDY54SEVSFQPKRBIT76MOANUEUPK33UTDCGI75N7M";
  const wasitJson = JSON.parse(fs.readFileSync(new URL("./fixtures/wasit-conformant.json", import.meta.url), "utf8"));
  const withPay = {
    ...wasitJson,
    results: [...wasitJson.results, { id: "X402-06", name: "n", status: "PASS", detail: `Valid payment accepted (HTTP 200) and settled on-chain for exactly the advertised 500000 base units of CBIEL to ${payee}, verified from the transfer event (tx ${hash}).` }],
  };
  const p = extractPayment(withPay, payer);
  assert.equal(p.txHash, hash);
  assert.equal(p.payee, payee);
  assert.equal(p.payer, payer);
  assert.equal(p.links.tx, `https://stellar.expert/explorer/testnet/tx/${hash}`);
  assert.equal(p.links.payer, `https://stellar.expert/explorer/testnet/account/${payer}`);
  // no matching text, or a failing check: no proof, nothing guessed
  assert.equal(extractPayment(wasitJson, payer), null);
  assert.equal(extractPayment({ results: [{ id: "X402-06", status: "FAIL", detail: `(tx ${hash})` }] }, payer), null);
  assert.equal(extractPayment(withPay, "not-an-address").payer, null);

  const report = buildReport({ ...base(withPay), full: true, payer });
  assert.equal(report.payment.txHash, hash);
  assert.ok(!JSON.stringify(report.results).includes(hash)); // the shortened text in the rows stays shortened
  const md = renderMarkdown(report);
  assert.match(md, /## Payment proof/);
  assert.ok(md.includes(`https://stellar.expert/explorer/testnet/tx/${hash}`));
  assert.match(md, /Run time:/);

  const body = buildFeedbackBody({ full: report });
  assert.ok(body.includes(`[${hash}](https://stellar.expert/explorer/testnet/tx/${hash})`));
  assert.ok(body.includes(`[${payer}](https://stellar.expert/explorer/testnet/account/${payer})`));
  assert.ok(body.includes(`[${payee}](https://stellar.expert/explorer/testnet/account/${payee})`));
  assert.match(body, /Run time: \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC \(\d{2}:\d{2} WIB, \d{2}:\d{2} WITA, \d{2}:\d{2} WIT\)/);
  assert.ok(!/S[A-Z2-7]{55}/.test(body));
  // a read-only report has a run time but no payment lines
  const ro = buildFeedbackBody({ readOnly: buildReport({ ...base(wasitJson), full: false }) });
  assert.match(ro, /Run time:/);
  assert.ok(!/Payment transaction/.test(ro));
});
