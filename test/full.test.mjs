import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { TESTNET_USDC_ISSUER, checkPayerReady, ensureFullPayee, parsePrice, payerHelp } from "../lib/full.mjs";
import { buildReport, FULL_NOTE } from "../lib/report.mjs";
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
  assert.deepEqual(r.notes, [FULL_NOTE]);
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
