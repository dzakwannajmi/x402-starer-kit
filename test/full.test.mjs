import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { TESTNET_USDC_ISSUER, checkPayerReady, ensureFullPayee, parsePrice, payerHelp } from "../lib/full.mjs";
import { buildReport, maskSecrets, FULL_NOTE, FULL_UNPAID_NOTE, READONLY_NOTE } from "../lib/report.mjs";
import { checkName } from "../lib/names.mjs";
import { exerciseStatus, formatUsdc } from "../lib/report.mjs";
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

// events (optional): an array that records each network step in order, so a test can see what ran when.
function fakeStellar({ existing = null, neverAppears = false, quote = null, swapFails = false, trustFails = false, secret = "SHOULD-NEVER-BE-READ", events = null } = {}) {
  const calls = { friendbot: 0, submitted: 0, swapSubmitted: 0, ops: [] };
  class Server {
    strictSendPaths() {
      events?.push("quote");
      return { call: async () => ({ records: quote ? [{ destination_amount: quote, path: [] }] : [] }) };
    }
    async loadAccount(id) {
      events?.push("load");
      if (existing && id === existing.id) return { balances: existing.balances };
      if (neverAppears) throw new Error("not found");
      return { balances: [] };
    }
    async submitTransaction(tx) {
      events?.push(tx.withSwap ? "submit-swap" : "submit-trust");
      calls.submitted++;
      if (tx.withSwap) {
        calls.swapSubmitted++;
        if (swapFails) throw new Error("op_under_dest_min");
      } else if (trustFails) {
        throw new Error("tx_failed");
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
      Keypair: { random: () => ({ publicKey: () => "GNEWPAYEE", secret: () => secret }) },
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
  const paid = { ...wasitJson, passed: wasitJson.passed + 1, results: [...wasitJson.results, { id: "X402-06", name: "n", status: "PASS", detail: "d" }] };
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
    say: () => {},
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
    createPayer({ stellar, fetchImpl: async () => ({ ok: false, status: 503 }), writeEnv: () => (written = true), sleep: async () => {}, say: () => {} }),
    /Friendbot.*503/,
  );
  assert.equal(written, false);
  const { stellar: s2 } = fakeStellar({ neverAppears: true });
  await assert.rejects(createPayer({ stellar: s2, fetchImpl: async () => ({ ok: true }), writeEnv: () => (written = true), sleep: async () => {}, say: () => {} }), /did not appear/);
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
  const r = await createPayer({ stellar, fetchImpl: async () => ({ ok: true, status: 200 }), writeEnv: (s) => (written = s), sleep: async () => {}, say: () => {} });
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
    const r = await createPayer({ stellar, fetchImpl: async () => ({ ok: true, status: 200 }), writeEnv: (s) => (written = s), sleep: async () => {}, say: () => {} });
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
    passed: wasitJson.passed + 1, // the added row is a PASS: the summary numbers must still match the rows
    results: [...wasitJson.results, { id: "X402-06", name: "n", status: "PASS", detail: `Valid payment accepted (HTTP 200) and settled on-chain for exactly the advertised 500000 base units of CBIEL to ${payee}, verified from the transfer event (tx ${hash}).` }],
  };
  const p = extractPayment(withPay, payer);
  assert.equal(p.txHash, hash);
  assert.equal(p.payee, payee);
  assert.equal(p.payer, payer);
  assert.equal(p.amountBaseUnits, "500000");
  assert.equal(p.amountUsdc, "0.05");
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
  assert.match(md, /\*\*Amount:\*\* 500000 base units = 0\.05 USDC/);
  assert.ok(md.includes(`https://stellar.expert/explorer/testnet/tx/${hash}`));
  assert.match(md, /Run time:/);

  const body = buildFeedbackBody({ full: report });
  assert.ok(body.includes(`[${hash}](https://stellar.expert/explorer/testnet/tx/${hash})`));
  assert.ok(body.includes("- Amount: 500000 base units = 0.05 USDC (7 decimals)"));
  assert.ok(body.includes(`[${payer}](https://stellar.expert/explorer/testnet/account/${payer})`));
  assert.ok(body.includes(`[${payee}](https://stellar.expert/explorer/testnet/account/${payee})`));
  assert.match(body, /Run time: \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC \(\d{2}:\d{2} WIB, \d{2}:\d{2} WITA, \d{2}:\d{2} WIT\)/);
  assert.ok(!/S[A-Z2-7]{55}/.test(body));
  // a read-only report has a run time but no payment lines
  const ro = buildFeedbackBody({ readOnly: buildReport({ ...base(wasitJson), full: false }) });
  assert.match(ro, /Run time:/);
  assert.ok(!/Payment transaction/.test(ro));
});

// ---- review fixes of 2026-10-22 ----

test("a long feedback address is not opened for the participant on Windows, but is on macOS and Linux", async () => {
  const { canAutoOpen, WINDOWS_AUTO_OPEN_MAX, buildFeedbackUrl } = await import("../lib/feedback.mjs");
  const short = "https://github.com/wasit-dev/Wasit/issues/new?title=x";
  const long = "https://github.com/wasit-dev/Wasit/issues/new?body=" + "a".repeat(WINDOWS_AUTO_OPEN_MAX);
  assert.equal(canAutoOpen({ platform: "win32", url: short }), true);
  assert.equal(canAutoOpen({ platform: "win32", url: long }), false);
  assert.equal(canAutoOpen({ platform: "darwin", url: long }), true);
  assert.equal(canAutoOpen({ platform: "linux", url: long }), true);
  // The empty form is short enough to open on Windows too.
  assert.equal(canAutoOpen({ platform: "win32", url: buildFeedbackUrl({}) }), true);
});

test("the yes/no question explains a wrong answer and never turns into yes by itself", async () => {
  const { askYesNo } = await import("../lib/nextsteps.mjs");
  const run = async (answers) => {
    const said = [];
    const it = answers[Symbol.iterator]();
    const result = await askYesNo(
      async () => {
        const n = it.next();
        if (n.done) throw new Error("closed");
        if (n.value instanceof Error) throw n.value;
        return n.value;
      },
      (t) => said.push(t),
      "q",
    );
    return { result, said };
  };
  assert.deepEqual(await run(["yes"]), { result: true, said: [] });
  assert.deepEqual(await run(["no"]), { result: false, said: [] });
  assert.deepEqual(await run(["ya", "Y"]), { result: true, said: ["Please type y (yes) or n (no)."] });
  assert.deepEqual(await run(["y"]), { result: true, said: [] });
  assert.deepEqual(await run(["N"]), { result: false, said: [] });
  const three = await run(["ya", "iya", "mungkin"]);
  assert.equal(three.result, false);
  assert.deepEqual(three.said, ["Please type y (yes) or n (no).", "Please type y (yes) or n (no).", "That is not y or n, so it counts as no."]);
  assert.equal((await run([""])).result, false); // the terminal closed after one empty answer
  assert.equal((await run([new Error("closed")])).result, false);
});

test("createPayer moves exactly 10 test XLM on testnet to the payer itself, with a 80% price guard", async () => {
  const { createPayer, SWAP_XLM, SWAP_MIN_SHARE, TESTNET_HORIZON_URL, FRIENDBOT_URL, TESTNET_USDC_ISSUER: ISSUER } = await import("../lib/full.mjs");
  const seen = { horizon: [], passphrase: [], ops: [], friendbot: [] };
  class Server {
    constructor(url) {
      seen.horizon.push(url);
    }
    strictSendPaths() {
      return { call: async () => ({ records: [{ destination_amount: "9.0", path: [] }] }) };
    }
    async loadAccount() {
      return { balances: [] };
    }
    async submitTransaction() {}
  }
  class TB {
    constructor(acc, opts) {
      seen.passphrase.push(opts.networkPassphrase);
    }
    addOperation(op) {
      seen.ops.push(op);
      return this;
    }
    setTimeout() {
      return this;
    }
    build() {
      return { sign() {} };
    }
  }
  class Asset {
    constructor(code, issuer) {
      this.code = code;
      this.issuer = issuer;
    }
    static native() {
      return { native: true };
    }
  }
  const stellar = {
    Keypair: { random: () => ({ publicKey: () => "GNEWPAYER", secret: () => "SHOULD-NEVER-BE-READ" }) },
    Horizon: { Server },
    TransactionBuilder: TB,
    Operation: { changeTrust: (a) => ({ kind: "trust", ...a }), pathPaymentStrictSend: (a) => ({ kind: "swap", ...a }) },
    Asset,
    Networks: { TESTNET: "TESTNET-PASSPHRASE", PUBLIC: "PUBLIC-PASSPHRASE" },
    BASE_FEE: "100",
  };
  const r = await createPayer({ stellar, fetchImpl: async (u) => (seen.friendbot.push(String(u)), { ok: true, status: 200 }), writeEnv: () => {}, sleep: async () => {}, say: () => {} });
  assert.equal(r.swapped, true);
  // Only the test network: its Horizon, its Friendbot, its passphrase.
  assert.deepEqual(seen.horizon, [TESTNET_HORIZON_URL]);
  assert.ok(seen.passphrase.length >= 1 && seen.passphrase.every((p) => p === "TESTNET-PASSPHRASE"));
  assert.ok(seen.friendbot.every((u) => u.startsWith(`${FRIENDBOT_URL}?addr=GNEWPAYER`)));
  // The swap: 10 XLM, to the payer itself, for test USDC, accepting at least 80% of the quote (9.0 * 0.8 = 7.2).
  const swaps = seen.ops.filter((o) => o.kind === "swap");
  assert.equal(swaps.length, 1);
  assert.equal(SWAP_XLM, "10");
  assert.equal(swaps[0].sendAmount, "10");
  assert.deepEqual(swaps[0].sendAsset, { native: true });
  assert.equal(swaps[0].destination, "GNEWPAYER");
  assert.equal(swaps[0].destAsset.code, "USDC");
  assert.equal(swaps[0].destAsset.issuer, ISSUER);
  assert.equal(SWAP_MIN_SHARE, 0.8);
  assert.equal(swaps[0].destMin, "7.2000000");
  // The trustline is for the same test USDC.
  const trust = seen.ops.filter((o) => o.kind === "trust");
  assert.ok(trust.length >= 1 && trust.every((o) => o.asset.issuer === ISSUER));
});

test("formatUsdc turns base units into USDC with 7 decimals and never guesses", () => {
  assert.equal(formatUsdc("1000000"), "0.1");
  assert.equal(formatUsdc("500000"), "0.05");
  assert.equal(formatUsdc("10000"), "0.001");
  assert.equal(formatUsdc("50000"), "0.005");
  assert.equal(formatUsdc("10000000"), "1");
  assert.equal(formatUsdc("12345678"), "1.2345678");
  assert.equal(formatUsdc("0"), "0");
  assert.equal(formatUsdc(null), null);
  assert.equal(formatUsdc("1e6"), null);
  assert.equal(formatUsdc("-5"), null);
});

// ---- progress while the payer is made (2026-10-24) ----

// Shaped like a real Stellar secret key, so the S[A-Z2-7]{55} checks below can actually catch it.
const KEY_LIKE = "S" + "C".repeat(55);

/** Runs createPayer on the fake network. events holds each step and each progress line (by its PAYER_PROGRESS name) in order. */
async function runCreatePayer(opts, { fetchOk = true, say } = {}) {
  const { createPayer, PAYER_PROGRESS } = await import("../lib/full.mjs");
  const nameOf = (line) => Object.entries(PAYER_PROGRESS).find(([, v]) => v === line)?.[0] ?? line;
  const events = [];
  const lines = [];
  const { stellar } = fakeStellar({ ...opts, secret: KEY_LIKE, events });
  let written = null;
  let result;
  let error;
  try {
    result = await createPayer({
      stellar,
      fetchImpl: async () => (events.push("friendbot"), fetchOk ? { ok: true, status: 200 } : { ok: false, status: 503 }),
      writeEnv: (s) => (events.push("writeEnv"), (written = s)),
      sleep: async () => {},
      say: say ?? ((line) => (events.push(`say:${nameOf(line)}`), lines.push(line))),
    });
  } catch (e) {
    error = e;
  }
  return { result, error, written, events, lines };
}

test("createPayer says each step just before it runs, in order, and never shows the key", async () => {
  const { PAYER_PROGRESS, SWAP_XLM } = await import("../lib/full.mjs");
  const start = ["say:friendbot", "friendbot", "load", "say:quote", "quote"];
  const cases = [
    { opts: { quote: "8.8" }, steps: [...start, "say:swap", "submit-swap", "load", "writeEnv"] },
    { opts: { quote: null }, steps: [...start, "say:noQuote", "load", "submit-trust", "writeEnv"] },
    { opts: { quote: "0.2" }, steps: [...start, "say:noQuote", "load", "submit-trust", "writeEnv"] }, // under 1 USDC: no usable price
    { opts: { quote: "8.8", swapFails: true }, steps: [...start, "say:swap", "submit-swap", "say:swapFailed", "load", "submit-trust", "writeEnv"] },
  ];
  for (const { opts, steps } of cases) {
    const r = await runCreatePayer(opts);
    assert.equal(r.error, undefined, JSON.stringify(opts));
    assert.deepEqual(r.events, steps, JSON.stringify(opts));
    assert.equal(r.written, KEY_LIKE); // the key still reaches writeEnv, and only writeEnv
    assert.ok(r.lines.length >= 3);
    for (const line of r.lines) assert.ok(!/S[A-Z2-7]{55}/.test(line) && !line.includes(KEY_LIKE), line);
  }
  // The amount in the words is the amount the swap sends.
  assert.ok(PAYER_PROGRESS.quote.includes(`${SWAP_XLM} test XLM`));
  assert.ok(PAYER_PROGRESS.swap.includes(`swapping ${SWAP_XLM} test XLM for test USDC`));
  for (const v of Object.values(PAYER_PROGRESS)) assert.ok(!/S[A-Z2-7]{55}|[0-9a-fA-F]{64}/.test(v), v);
});

test("createPayer fails exactly as before when a step fails, with progress up to that step only", async () => {
  const fb = await runCreatePayer({}, { fetchOk: false });
  assert.equal(fb.error.message, "Friendbot (the public testnet faucet for XLM) answered HTTP 503. Try again in a minute.");
  assert.deepEqual(fb.events, ["say:friendbot", "friendbot"]);
  assert.equal(fb.written, null);

  const gone = await runCreatePayer({ neverAppears: true });
  assert.equal(gone.error.message, "The new payer account did not appear on testnet in time. Try again.");
  // still 8 tries; the wait is said once
  assert.deepEqual(gone.events, ["say:friendbot", "friendbot", "load", "say:waiting", ...Array(7).fill("load")]);
  assert.equal(gone.written, null);

  const trust = await runCreatePayer({ quote: null, trustFails: true });
  assert.equal(trust.error.message, "tx_failed"); // the network's own error passes through untouched
  assert.deepEqual(trust.events, ["say:friendbot", "friendbot", "load", "say:quote", "quote", "say:noQuote", "load", "submit-trust"]);
  assert.equal(trust.written, null);

  for (const r of [fb, gone, trust]) assert.ok(r.lines.every((l) => !/S[A-Z2-7]{55}/.test(l)));
});

test("a progress line that cannot be printed never changes what happens to the payer or its key", async () => {
  const boom = () => {
    throw new Error("EPIPE");
  };
  const quiet = await runCreatePayer({ quote: "8.8" }, { say: () => {} });
  const broken = await runCreatePayer({ quote: "8.8" }, { say: boom });
  assert.equal(broken.error, undefined);
  assert.deepEqual(broken.result, quiet.result);
  assert.deepEqual(broken.events, quiet.events); // the same steps in the same order
  assert.equal(broken.written, KEY_LIKE);
  const brokenFb = await runCreatePayer({}, { fetchOk: false, say: boom });
  assert.equal(brokenFb.error.message, "Friendbot (the public testnet faucet for XLM) answered HTTP 503. Try again in a minute.");
  assert.equal(brokenFb.written, null);
  // an async say that rejects is ignored too: no unhandled rejection after the key was funded
  const rejecting = await runCreatePayer({ quote: "8.8" }, { say: () => Promise.reject(new Error("async EPIPE")) });
  await new Promise((r) => setImmediate(r));
  assert.equal(rejecting.error, undefined);
  assert.deepEqual(rejecting.events, quiet.events);
  assert.equal(rejecting.written, KEY_LIKE);
});

test("the generated check script prints the payer progress through maskSecrets", () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "kit-say-"));
  try {
    const g = generateProject({ name: "Say Test", seed: 7, parentDir: parent });
    const check = fs.readFileSync(path.join(g.dir, "scripts", "check.mjs"), "utf8");
    assert.match(check, /createPayer\(\{[\s\S]*?say: \(line\) => console\.log\(maskSecrets\(line\)\)[\s\S]*?\}\);/);
    assert.match(fs.readFileSync(path.join(g.dir, "scripts", "full.mjs"), "utf8"), /export const PAYER_PROGRESS/);
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

// ---- a second `npm run check` with a .env already there (issue #18, 2026-10-24) ----

// The words a yes printed before the payer could be looked up. Pinned here: every case without a readable answer keeps them.
const OLD_ENV_TEXT =
  "A .env file already exists in this folder, so the kit did not make a payer. If it holds your test payer key you are ready; otherwise run npm run check:full for the steps.";
const ENV_HEAD = "A .env file already exists in this folder, so the kit did not make a new payer.";
const PAYER_G = "GCP4DXPV3P26OJEEDY54SEVSFQPKRBIT76MOANUEUPK33UTDCGI75N7M"; // shaped like a real public address
const HEX64 = "ab".repeat(32);
const SHOWN = "npx -y @wasit-dev/cli@0.7.0";
const statusOf = (publicKey, balances, exists = true) => [{ role: "x402", configured: true, publicKey, status: { exists, balances } }];
const usdcRow = (balance) => [{ code: "USDC", issuer: TESTNET_USDC_ISSUER, balance }];
// What `wasit wallet status ... --json` printed, as run() hands it over. calls counts the lookups.
const fakeWasit = (reply) => {
  const f = async () => {
    f.calls++;
    if (reply instanceof Error) throw reply;
    return reply;
  };
  f.calls = 0;
  return f;
};
const json = (rows, code = 0) => ({ code, stdout: JSON.stringify(rows, null, 2), stderr: "" });

/** The generated project's own copies of the helpers, so the code under test is the code a participant runs. */
async function generatedHelpers(fn) {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "kit-env-"));
  try {
    const g = generateProject({ name: "Env Test", seed: 8, parentDir: parent });
    const load = (f) => import(pathToFileURL(path.join(g.dir, "scripts", f)).href);
    await fn({ full: await load("full.mjs"), next: await load("nextsteps.mjs"), report: await load("report.mjs"), dir: g.dir });
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
}

/** What check.mjs does after a yes when .env exists: the shared lookup, then the text, then the closing text. */
async function secondCheck({ full, next }, runStatus, price = "$0.01") {
  const readStatus = runStatus ? () => full.readPayerStatus(runStatus, full.parsePrice(price)) : null;
  const r = await full.existingPayerText(readStatus, { price, wasitCommand: SHOWN });
  const closing = next.nextStepsText({ full: false, outcome: "conformant", exerciseUnsolved: false, answeredYes: true, payerReady: r.ready });
  return { ...r, closing };
}

test("readPayerStatus reads Wasit's JSON whatever the exit code, and hands back Wasit's own text when it is not JSON", async () => {
  const { readPayerStatus } = await import("../lib/full.mjs");
  const ok = fakeWasit(json(statusOf(PAYER_G, usdcRow("18.5"))));
  assert.deepEqual(await readPayerStatus(ok, 0.01), { ready: { ok: true, publicKey: PAYER_G, balance: 18.5 } });
  assert.equal(ok.calls, 1);
  // with --role, Wasit exits 2 for a payer it could not look up, and still prints the row
  assert.equal((await readPayerStatus(fakeWasit(json([{ role: "x402", configured: false }], 2)), 0.01)).ready.reason, "not-configured");
  assert.deepEqual(await readPayerStatus(fakeWasit({ code: -1, stdout: "", stderr: "Error: spawn npx ENOENT" }), 0.01), { ready: null, unreadable: "Error: spawn npx ENOENT" });
  assert.deepEqual(await readPayerStatus(fakeWasit({ code: 1, stdout: "npm error 404", stderr: "" }), 0.01), { ready: null, unreadable: "npm error 404" });
  assert.deepEqual(await readPayerStatus(fakeWasit({ code: null, stdout: "", stderr: "" }), 0.01), { ready: null, unreadable: "" }); // killed by the time limit
  assert.deepEqual(await readPayerStatus(fakeWasit({ code: 1, stdout: "x", stderr: "y" }), 0.01), { ready: null, unreadable: "y" }); // stderr wins when both have text
});

test("second check, payer ready: the public address and balance, and straight to npm run check:full", async () => {
  await generatedHelpers(async (h) => {
    const wasit = fakeWasit(json(statusOf(PAYER_G, [{ code: "XLM", balance: "9989.99" }, ...usdcRow("8.8000000")])));
    const r = await secondCheck(h, wasit);
    assert.equal(wasit.calls, 1); // one read-only lookup, nothing else
    assert.equal(r.ready, true);
    assert.equal(r.publicKey, PAYER_G);
    assert.equal(r.text, `${ENV_HEAD} Wasit checked your test payer:\nPayer ready: ${PAYER_G} holds 8.8 USDC (testnet).`);
    assert.equal(r.closing, h.next.TEXT.runFullNow);
    assert.match(r.closing, /^You must run this command to run the full payment check:\n  npm run check:full/);
  });
});

test("second check, payer not ready: the same help a full run gives, and no runFullNow", async () => {
  await generatedHelpers(async (h) => {
    const cases = [
      json(statusOf(PAYER_G, usdcRow("0.0000000"))), // trustline, no USDC
      json(statusOf(PAYER_G, [{ code: "XLM", balance: "10000" }])), // no trustline yet
      json(statusOf(PAYER_G, usdcRow("0.01"))), // under twice the price
      json(statusOf(PAYER_G, [], false)), // not on testnet yet
      json([{ role: "x402", configured: false }], 2), // .env without a payer key
      json([{ role: "x402", configured: true, error: "STELLAR_PRIVATE_KEY is not a valid Stellar secret key." }], 2),
      json([{ role: "x402", configured: true, publicKey: PAYER_G, error: "Could not reach https://horizon-testnet.stellar.org" }], 2),
    ];
    for (const reply of cases) {
      const r = await secondCheck(h, fakeWasit(reply));
      const expected = h.full.checkPayerReady(JSON.parse(reply.stdout), 0.01);
      assert.equal(expected.ok, false);
      assert.equal(r.ready, false, reply.stdout);
      assert.equal(r.text, `${ENV_HEAD}\n${h.full.payerHelp(expected, { price: "$0.01", wasitCommand: SHOWN })}`);
      assert.equal(r.closing, h.next.TEXT.runFull);
    }
  });
});

test("second check without a readable answer, or offline: the old words, unchanged", async () => {
  await generatedHelpers(async (h) => {
    assert.equal(h.full.ENV_EXISTS_TEXT, OLD_ENV_TEXT);
    // no lookup at all (Wasit could not start, or the run is offline): Wasit is never asked
    const none = await secondCheck(h, null);
    assert.deepEqual({ ready: none.ready, text: none.text }, { ready: false, text: OLD_ENV_TEXT });
    assert.equal(none.closing, h.next.TEXT.runFull);
    const unreadable = [
      { code: -1, stdout: "", stderr: "Error: spawn npx ENOENT" },
      { code: 1, stdout: "npm error code E404", stderr: "npm error 404 Not Found" },
      { code: null, stdout: '[{"role":"x40', stderr: "" }, // cut off by the time limit
      new Error("spawn failed"),
      json(statusOf(PAYER_G, {})), // balances of a shape checkPayerReady cannot read
      json(statusOf(PUB, usdcRow("18.5"))), // "ready", but not a public address
      json(statusOf(undefined, usdcRow("18.5"))),
      json(statusOf(KEY_LIKE, usdcRow("18.5"))), // a secret key where the address should be is never printed as one
    ];
    for (const reply of unreadable) {
      const wasit = fakeWasit(reply);
      const r = await secondCheck(h, wasit);
      assert.equal(wasit.calls, 1);
      assert.deepEqual({ ready: r.ready, text: r.text }, { ready: false, text: OLD_ENV_TEXT }, String(reply?.stdout ?? reply));
      assert.equal(r.closing, h.next.TEXT.runFull);
    }
  });
});

test("second check: nothing that looks like a key or a 64-hex value is printed, whatever Wasit answers", async () => {
  await generatedHelpers(async (h) => {
    const leak = `${KEY_LIKE} ${HEX64} 0x${HEX64}`;
    const replies = [
      json(statusOf(PAYER_G, usdcRow("18.5"))),
      json(statusOf(PAYER_G, usdcRow("0"))),
      json([{ role: "x402", configured: true, error: `bad key ${leak}` }], 2),
      json([{ role: "x402", configured: true, publicKey: KEY_LIKE, status: { exists: false } }], 2),
      json(statusOf(KEY_LIKE, usdcRow("18.5"))),
      { code: 1, stdout: leak, stderr: leak },
      null,
    ];
    for (const reply of replies) {
      const r = await secondCheck(h, reply ? fakeWasit(reply) : null);
      const printed = `${h.report.maskSecrets(r.text)}\n${r.closing}`; // check.mjs prints the text through maskSecrets
      assert.ok(!/S[A-Z2-7]{55}/.test(printed) && !/[0-9a-fA-F]{64}/.test(printed), printed);
      assert.ok(!printed.includes(KEY_LIKE));
    }
    // the kit's own words carry nothing secret even before masking; only Wasit's words need it
    for (const t of [OLD_ENV_TEXT, ENV_HEAD, h.full.ENV_LOOKUP_TEXT, ...Object.values(h.next.TEXT)]) assert.ok(!/S[A-Z2-7]{55}|[0-9a-fA-F]{64}/.test(t));
    assert.equal(h.full.ENV_LOOKUP_TEXT, "Checking the test payer in .env with Wasit (read-only, testnet) ...");
  });
});

test("the generated check script looks the payer up through one shared helper, prints it masked, and skips it offline", () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "kit-wire-"));
  try {
    const g = generateProject({ name: "Wire Test", seed: 9, parentDir: parent });
    const check = fs.readFileSync(path.join(g.dir, "scripts", "check.mjs"), "utf8");
    const fullSrc = fs.readFileSync(path.join(g.dir, "scripts", "full.mjs"), "utf8");
    // one `wallet status` command in the whole script, run in the project folder: both callers share it
    assert.equal(check.match(/"wallet", "status"/g).length, 1);
    assert.match(check, /const args = \[\.\.\.wasit\.prefix, "wallet", "status", "--role", "x402", "--network", NETWORK, "--json"\];/);
    assert.match(check, /const NETWORK = "stellar:testnet";/);
    assert.match(check, /spawn\(cmd, args, \{ cwd: root, shell, stdio: \["ignore", "pipe", "pipe"\] \}\)/);
    // the full run keeps run()'s own time limit; the lookup after a yes gives up after 30 seconds
    assert.match(check, /async function prepareFull\(wasit\) \{\n  const st = await payerStatus\(wasit\);/);
    assert.match(check, /function run\(cmd, args, \{ timeoutMs = 180000, shell = false \} = \{\}\)/);
    assert.match(check, /return readPayerStatus\(\(\) => run\(wasit\.cmd, args, \{ shell: wasit\.shell, timeoutMs \}\), parsePrice\(project\.variant\.price\)\);/);
    assert.match(check, /const PAYER_LOOKUP_TIMEOUT_MS = 30000;/);
    assert.match(
      check,
      /if \(fs\.existsSync\(envPath\)\) \{\n    const lookup = wasit\?\.cmd \? \(\) => payerStatus\(wasit, \{ timeoutMs: PAYER_LOOKUP_TIMEOUT_MS \}\) : null;\n    if \(lookup\) console\.log\(ENV_LOOKUP_TEXT\);[^\n]*\n    const known = await existingPayerText\(lookup, [^\n]+\);\n    console\.log\(maskSecrets\(known\.text\)\);\n    return known\.ready \? \{ publicKey: known\.publicKey, ready: true \} : null;\n  \}/,
    );    // the full run makes its payer exactly as before; only the yes after a read-only run looks up an existing one
    assert.match(check, /const made = await setupPayer\(\);\n    if \(made\?\.swapped\) return prepareFull\(wasit\);/);
    assert.match(check, /const made = await setupPayer\(choice\.mode === "stub" \? null : wasit\);\n    payerReady = Boolean\(made\?\.swapped \|\| made\?\.ready\);/);
    assert.ok(!/checkPayerReady\(/.test(check), "the status is judged in scripts/full.mjs only");
    // every name check.mjs takes from ./full.mjs exists there
    const names = /import \{([^}]+)\} from "\.\/full\.mjs";/.exec(check)[1].split(",").map((s) => s.trim());
    for (const n of names) assert.match(fullSrc, new RegExp(`export (?:async function|function|const) ${n}\\b`), n);
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});
