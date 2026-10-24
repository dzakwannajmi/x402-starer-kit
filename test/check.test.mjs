// The generated check script, run for real: a stand-in seller (no dependencies) and a stand-in Wasit (WASIT_BIN), so
// nothing goes to the network and no key is involved. A preload marks stdin and stdout as a terminal, so the question
// after a conformant read-only run is asked; "y" is typed through a pipe. The --full cases stop at the payer check,
// before the seller or the Stellar SDK is started.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { generateProject } from "../lib/generate.mjs";
import { ENV_LOOKUP_TEXT, TESTNET_USDC_ISSUER, checkPayerReady, parsePrice, payerHelp } from "../lib/full.mjs";
import { TEXT } from "../lib/nextsteps.mjs";
import { pickVariant } from "../lib/variants.mjs";

const FIXTURE = new URL("./fixtures/wasit-conformant.json", import.meta.url);
const SEED = 5;
const PRICE = pickVariant(SEED).variant.price; // the price of the project runCheck makes
const PAYER_G = "GCP4DXPV3P26OJEEDY54SEVSFQPKRBIT76MOANUEUPK33UTDCGI75N7M";
const KEY_LIKE = "S" + "C".repeat(55); // shaped like a Stellar secret key; not a real one
const HEX64 = "cd".repeat(32);
const SHOWN = "npx -y @wasit-dev/cli@0.7.0";
const OLD_ENV_TEXT =
  "A .env file already exists in this folder, so the kit did not make a payer. If it holds your test payer key you are ready; otherwise run npm run check:full for the steps.";
const CUSTOM_HINT = "npm run check:full uses the public testnet facilitator only: unset FACILITATOR_URL before you run it.";

// Records each call (arguments and working folder), then answers like Wasit would.
const FAKE_WASIT = `import fs from "node:fs";
const args = process.argv.slice(2);
fs.appendFileSync(process.env.FAKE_WASIT_LOG, JSON.stringify({ args, cwd: fs.realpathSync.native(process.cwd()) }) + "\\n");
if (args[0] === "--version") { console.log("0.7.0"); process.exit(0); }
if (args[0] === "test") { process.stdout.write(fs.readFileSync(process.env.FAKE_WASIT_TEST, "utf8")); process.exit(0); }
if (args[0] === "wallet" && args[1] === "status") {
  process.stdout.write(process.env.FAKE_STATUS_STDOUT ?? "");
  process.stderr.write(process.env.FAKE_STATUS_STDERR ?? "");
  process.exit(Number(process.env.FAKE_STATUS_CODE ?? 0));
}
process.exit(9);
`;
const FAKE_SELLER = `import http from "node:http";
http.createServer((_q, r) => { r.statusCode = 402; r.end("{}"); }).listen(Number(process.env.PORT), "127.0.0.1");
`;
const FAKE_TTY = `Object.defineProperty(process.stdin, "isTTY", { value: true });
Object.defineProperty(process.stdout, "isTTY", { value: true });
`;

/**
 * One run of the generated check script with a .env already in the folder; "y" is typed if the question comes.
 * flag: --online, --offline or --full. status: what `wallet status` prints. env: extra environment.
 */
function runCheck({ flag = "--online", status = { stdout: "", stderr: "", code: 0 }, env: extra = {} } = {}) {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "kit-check-"));
  try {
    const g = generateProject({ name: "Second Check", seed: SEED, parentDir: parent });
    fs.writeFileSync(path.join(g.dir, "server.mjs"), FAKE_SELLER);
    // A stand-in .env with a key-shaped value: the kit never reads it, so it must never show up.
    fs.writeFileSync(path.join(g.dir, ".env"), `STELLAR_PRIVATE_KEY=${KEY_LIKE}\n`);
    const bin = path.join(parent, "fake-wasit.mjs");
    const tty = path.join(parent, "tty.mjs");
    const log = path.join(parent, "wasit-calls.log");
    fs.writeFileSync(bin, FAKE_WASIT);
    fs.writeFileSync(tty, FAKE_TTY);
    fs.writeFileSync(log, "");
    const env = {
      ...process.env,
      WASIT_BIN: bin,
      FAKE_WASIT_LOG: log,
      FAKE_WASIT_TEST: fs.realpathSync(FIXTURE),
      FAKE_STATUS_STDOUT: status.stdout,
      FAKE_STATUS_STDERR: status.stderr,
      FAKE_STATUS_CODE: String(status.code),
      NO_COLOR: "1",
    };
    for (const k of ["CI", "FACILITATOR_URL", "KIT_PROBE_URL", "STELLAR_PRIVATE_KEY", "NODE_TEST_CONTEXT"]) delete env[k];
    Object.assign(env, extra);
    const r = spawnSync(process.execPath, ["--import", pathToFileURL(tty).href, path.join(g.dir, "scripts", "check.mjs"), flag], {
      cwd: g.dir,
      env,
      input: "y\n",
      encoding: "utf8",
      timeout: 60000,
    });
    const calls = fs.readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
    return {
      stdout: r.stdout,
      stderr: r.stderr,
      out: `${r.stdout}${r.stderr}`,
      status: r.status,
      calls,
      dir: fs.realpathSync.native(g.dir),
      envAfter: fs.readFileSync(path.join(g.dir, ".env"), "utf8"),
      files: fs.readdirSync(g.dir),
    };
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
}

const rowsWith = (balances) => JSON.stringify([{ role: "x402", configured: true, publicKey: PAYER_G, status: { exists: true, balances } }]);
const rows = (balance) => rowsWith([{ code: "USDC", issuer: TESTNET_USDC_ISSUER, balance }]);
const statusCalls = (calls) => calls.filter((c) => c.args[0] === "wallet");
const clean = (out) => !/S[A-Z2-7]{55}/.test(out) && !/[0-9a-fA-F]{64}/.test(out) && !out.includes(KEY_LIKE);

test("second check, payer ready: one read-only lookup in the project folder, the address and balance, then runFullNow", () => {
  const r = runCheck({ status: { stdout: rows("18.5"), stderr: "", code: 0 } });
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /Do you want to run the full payment check now\?/);
  const lookups = statusCalls(r.calls);
  assert.equal(lookups.length, 1);
  assert.deepEqual(lookups[0].args.slice(0, 7), ["wallet", "status", "--role", "x402", "--network", "stellar:testnet", "--json"]);
  assert.equal(lookups[0].cwd, r.dir); // Wasit loads .env from its working folder: this project's
  assert.deepEqual(r.calls.map((c) => c.args[0]), ["--version", "test", "wallet"]); // nothing else ran
  // the lookup line comes first, so the wait is not silent
  const at = r.stdout.indexOf(`\n${ENV_LOOKUP_TEXT}\n`);
  assert.ok(at >= 0 && at < r.stdout.indexOf(`Payer ready: ${PAYER_G} holds 18.5 USDC (testnet).`), r.out);
  assert.ok(r.stdout.endsWith(`\n${TEXT.runFullNow}\n`), r.out);
  assert.ok(!r.out.includes(TEXT.runFull) && !r.out.includes(OLD_ENV_TEXT) && !r.out.includes(CUSTOM_HINT));
  assert.equal(r.envAfter, `STELLAR_PRIVATE_KEY=${KEY_LIKE}\n`); // .env untouched
  assert.ok(!r.files.includes("payer-address.txt"));
  assert.ok(clean(r.out), r.out);
});

test("second check, payer not ready: the lookup line, the payer help, masked, and the old closing text", () => {
  const r = runCheck({ status: { stdout: rows("0.0000000"), stderr: "", code: 0 } });
  assert.equal(r.status, 0, r.out);
  assert.equal(statusCalls(r.calls).length, 1);
  assert.ok(r.stdout.includes(`\n${ENV_LOOKUP_TEXT}\n`), r.out);
  assert.match(r.out, /The payer has no test USDC\./);
  assert.ok(r.out.includes(PAYER_G));
  assert.ok(r.out.includes(TEXT.runFull) && !r.out.includes(TEXT.runFullNow), r.out);
  assert.ok(clean(r.out), r.out);
  // Wasit's own error words go through maskSecrets
  const bad = runCheck({ status: { stdout: JSON.stringify([{ role: "x402", configured: true, error: `bad ${KEY_LIKE} ${HEX64}` }]), stderr: "", code: 2 } });
  assert.ok(bad.stdout.includes(`\n${ENV_LOOKUP_TEXT}\n`), bad.out);
  assert.match(bad.out, /Could not check the payer: bad S<masked> cdcdcd\.\.\.cdcd/);
  assert.ok(bad.out.includes(TEXT.runFull) && !bad.out.includes(TEXT.runFullNow));
  assert.ok(clean(bad.out), bad.out);
});

test("second check, unreadable answer or offline: the old words, unchanged; the lookup line only where Wasit was asked", () => {
  const unreadable = runCheck({ status: { stdout: `npm error ${KEY_LIKE}`, stderr: `boom ${HEX64}`, code: 1 } });
  assert.equal(unreadable.status, 0, unreadable.out);
  assert.equal(statusCalls(unreadable.calls).length, 1);
  assert.ok(unreadable.stdout.endsWith(`\n\n${ENV_LOOKUP_TEXT}\n${OLD_ENV_TEXT}\n\n${TEXT.runFull}\n`), JSON.stringify(unreadable.stdout.slice(-400)));
  assert.ok(!/boom|npm error/.test(unreadable.out)); // Wasit's text is not shown in this case at all
  assert.ok(clean(unreadable.out), unreadable.out);

  const offline = runCheck({ flag: "--offline", status: { stdout: rows("18.5"), stderr: "", code: 0 } });
  assert.equal(offline.status, 0, offline.out);
  assert.equal(statusCalls(offline.calls).length, 0); // offline: Wasit is not asked about the payer
  assert.ok(offline.stdout.endsWith(`\n\n${OLD_ENV_TEXT}\n\n${TEXT.runFull}\n`), JSON.stringify(offline.stdout.slice(-400)));
  assert.ok(!offline.out.includes(ENV_LOOKUP_TEXT));
  assert.ok(clean(offline.out), offline.out);
});

test("second check with FACILITATOR_URL set: a ready payer is told to unset it before npm run check:full", () => {
  const r = runCheck({ status: { stdout: rows("18.5"), stderr: "", code: 0 }, env: { FACILITATOR_URL: "http://127.0.0.1:9" } });
  assert.equal(r.status, 0, r.out);
  assert.equal(statusCalls(r.calls).length, 1);
  assert.ok(r.out.includes(`Payer ready: ${PAYER_G} holds 18.5 USDC (testnet).`), r.out);
  assert.ok(r.stdout.endsWith(`\n${TEXT.runFullNow}\n\n${CUSTOM_HINT}\n`), JSON.stringify(r.stdout.slice(-400)));
  // and a full run with FACILITATOR_URL set is still refused, as the hint says
  const full = runCheck({ flag: "--full", env: { FACILITATOR_URL: "http://127.0.0.1:9" } });
  assert.equal(full.status, 2);
  assert.equal(full.stderr, "--full uses the public testnet facilitator only. Unset FACILITATOR_URL for this run.\n");
  assert.equal(full.calls.length, 0);
});

test("--full, unreadable payer status: Wasit's stderr, masked, word for word, and exit 2 before anything starts", () => {
  const r = runCheck({ flag: "--full", status: { stdout: "npm warn exec The following package was not found", stderr: `Error: bad ${KEY_LIKE} ${HEX64}`, code: 1 } });
  assert.equal(r.status, 2, r.out);
  assert.equal(r.stderr, "Could not read the payer status: Error: bad S<masked> cdcdcd...cdcd\nCheck your internet connection and run again.\n");
  assert.equal(r.stdout, "");
  assert.deepEqual(r.calls.map((c) => c.args.slice(0, 2).join(" ")), ["--version", "wallet status"]); // no seller, no test
  assert.ok(clean(r.out), r.out);
});

test("--full, payer not ready: the payer help with the Wasit command, and exit 2 before anything starts", () => {
  // low USDC: one payment's worth, under the two a full run needs
  const lowRows = rows(String(parsePrice(PRICE)));
  const ready = checkPayerReady(JSON.parse(lowRows), parsePrice(PRICE));
  assert.equal(ready.reason, "low-usdc");
  const low = runCheck({ flag: "--full", status: { stdout: lowRows, stderr: "", code: 0 } });
  assert.equal(low.status, 2, low.out);
  assert.equal(low.stdout, `${payerHelp(ready, { price: PRICE, wasitCommand: SHOWN })}\n`);
  assert.equal(low.stderr, "");
  assert.deepEqual(low.calls.map((c) => c.args.slice(0, 2).join(" ")), ["--version", "wallet status"]);
  // a low-USDC payer already has its trustline, so that help has no Wasit command; one without a trustline names it
  const noLine = runCheck({ flag: "--full", status: { stdout: rowsWith([{ code: "XLM", balance: "10000" }]), stderr: "", code: 0 } });
  assert.equal(noLine.status, 2, noLine.out);
  assert.ok(noLine.stdout.includes(`  1. ${SHOWN} wallet fund --role x402 --asset usdc`), noLine.out);
  assert.ok(clean(low.out) && clean(noLine.out));
});
