// Helpers for the optional full run (`npm run check:full`, copied to scripts/full.mjs). No imports: the check
// script passes in everything that needs the Stellar SDK, so these functions can be tested without it.
//
// A full run settles a REAL payment on Stellar testnet (X402-06) and sends four payments the seller must refuse
// (X402-07 to 10). Test funds only. It needs:
//   - a testnet payer holding Circle test USDC (created with `wasit wallet create`, funded at the Circle faucet);
//   - a payee account that exists and trusts USDC. The kit makes one: a throwaway account whose secret key is
//     discarded the moment it has been set up, so it can only receive and nothing secret is ever stored.

// Constants as used by Wasit itself (packages/core/src/wallet.ts, read 2026-10-18).
export const TESTNET_HORIZON_URL = "https://horizon-testnet.stellar.org";
export const FRIENDBOT_URL = "https://friendbot.stellar.org";
export const TESTNET_USDC_ISSUER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
export const FAUCET_URL = "https://faucet.circle.com";
// A new payer swaps this much test XLM for test USDC on the public test exchange, so no faucet is needed.
export const SWAP_XLM = "10";
export const SWAP_MIN_SHARE = 0.8; // accept at least 80% of the quoted USDC

// What createPayer says while it works, each line just before its step runs. Fixed text: never a key, an address or
// anything from .env. "Up to a minute" follows the 60-second time limit the transaction is built with (setTimeout(60)).
export const PAYER_PROGRESS = {
  friendbot: "Funding it with test XLM from Friendbot (the public testnet faucet) ...",
  waiting: "Waiting for the new account to appear on testnet ...",
  quote: `Asking the public test exchange what ${SWAP_XLM} test XLM buys in test USDC ...`,
  swap: `Adding the USDC trustline and swapping ${SWAP_XLM} test XLM for test USDC on the public test exchange (this can take up to a minute) ...`,
  noQuote: "The public test exchange gave no usable price, so there is no swap. Adding the USDC trustline ...",
  swapFailed: "The swap was not confirmed. Adding the USDC trustline on its own ...",
};

/** "$0.001" -> 0.001. Only the money strings the kit itself generates are accepted. */
export function parsePrice(price) {
  const m = /^\$(\d+(?:\.\d+)?)$/.exec(String(price));
  if (!m) throw new Error(`Unsupported price format: ${price}`);
  return Number(m[1]);
}

/**
 * Is the payer ready? statusJson is the parsed output of `wasit wallet status --role x402 --json`:
 *   [{ role, configured, publicKey, status: { exists, balances: [{ code, issuer, balance }] } }]
 */
export function checkPayerReady(statusJson, priceUsdc) {
  const entry = Array.isArray(statusJson) ? statusJson.find((e) => e && e.role === "x402") : null;
  if (!entry || !entry.configured) return { ok: false, reason: "not-configured" };
  const publicKey = entry.publicKey;
  // Wasit writes { configured: true, error } when the key is malformed or Horizon cannot be reached.
  if (entry.error) return { ok: false, reason: "status-error", publicKey, error: String(entry.error) };
  if (!entry.status || !entry.status.exists) return { ok: false, reason: "no-account", publicKey };
  const usdc = (entry.status.balances ?? []).find((b) => b.code === "USDC" && b.issuer === TESTNET_USDC_ISSUER);
  const balance = usdc ? Number(usdc.balance) : 0;
  if (!(balance > 0)) return { ok: false, reason: "no-usdc", publicKey, balance: 0, hasTrustline: Boolean(usdc) };
  // One payment settles in X402-06; the refused ones that follow should fail for their own reason, not for lack of funds.
  if (balance < 2 * priceUsdc) return { ok: false, reason: "low-usdc", publicKey, balance, hasTrustline: true };
  return { ok: true, publicKey, balance };
}

/**
 * Ask Wasit whether the payer a full run would use is ready. `runStatus()` runs `wasit wallet status --role x402
 * --network stellar:testnet --json` in the project folder and resolves to { stdout, stderr }. That command only reads:
 * STELLAR_PRIVATE_KEY (from .env, or from the shell if exported there) to work out the public address, then the
 * testnet balances; it signs and sends nothing. Returns { ready } with checkPayerReady's answer, or
 * { ready: null, unreadable } with Wasit's own text (stderr first) when its answer is not JSON: mask it before printing.
 */
export async function readPayerStatus(runStatus, priceUsdc) {
  const st = await runStatus();
  let parsed;
  try {
    parsed = JSON.parse(st.stdout);
  } catch {
    return { ready: null, unreadable: st.stderr || st.stdout };
  }
  return { ready: checkPayerReady(parsed, priceUsdc) };
}

// What a yes after `npm run check` says when .env already exists and the payer cannot be looked up.
export const ENV_EXISTS_TEXT =
  "A .env file already exists in this folder, so the kit did not make a payer. If it holds your test payer key you are ready; otherwise run npm run check:full for the steps.";
// Printed just before that lookup, and only when it really runs, so the wait is not silent. Fixed text.
export const ENV_LOOKUP_TEXT = "Checking the test payer in .env with Wasit (read-only, testnet) ...";

/**
 * A yes after `npm run check` with a .env already in the folder: no payer is made, so say whether the payer a full
 * run would use is ready. `readStatus` resolves like readPayerStatus; it is null when Wasit could not start or the
 * run is offline.
 * No lookup, an unreadable answer or an answer without a public address gives ENV_EXISTS_TEXT, word for word.
 * Returns { ready, text } (and publicKey when ready). The text can carry Wasit's words: mask it before printing.
 */
export async function existingPayerText(readStatus, { price, wasitCommand }) {
  let ready = null;
  try {
    ready = readStatus ? (await readStatus()).ready : null;
  } catch {
    ready = null; // an answer of an unexpected shape counts as unreadable
  }
  if (!ready) return { ready: false, text: ENV_EXISTS_TEXT };
  const head = "A .env file already exists in this folder, so the kit did not make a new payer.";
  if (ready.ok) {
    if (!/^G[A-Z2-7]{55}$/.test(String(ready.publicKey))) return { ready: false, text: ENV_EXISTS_TEXT };
    return { ready: true, publicKey: ready.publicKey, text: `${head} Wasit checked your test payer:\nPayer ready: ${ready.publicKey} holds ${ready.balance} USDC (testnet).` };
  }
  return { ready: false, text: `${head}\n${payerHelp(ready, { price, wasitCommand })}` };
}

/** What to tell the participant when the payer is not ready. Never contains a key; only public addresses. */
export function payerHelp(ready, { price, wasitCommand }) {
  const create =
    `Create a test payer:\n  ${wasitCommand} wallet create --role x402 --fund\n` +
    `It prints your new secret key on screen, so do not run it while you share or record your screen.\n` +
    `Copy the one line that starts with STELLAR_PRIVATE_KEY= into a file named .env in this project folder.\n` +
    `That key is yours: keep it private, never share or commit it, and use it for test money only.`;
  const usdc = (addr, hasTrustline) =>
    `Get test USDC:\n` +
    (hasTrustline ? "" : `  1. ${wasitCommand} wallet fund --role x402 --asset usdc   (lets the payer hold USDC: it adds a trustline)\n`) +
    `  ${hasTrustline ? "1" : "2"}. Open ${FAUCET_URL}, choose Stellar Testnet and paste this address:\n     ${addr}\n` +
    `The faucet step is manual: there is no scriptable USDC faucet for Stellar testnet.`;
  switch (ready.reason) {
    case "not-configured":
      return `No test payer found.\n${create}\nThen get test USDC (the next run tells you how), and run again.`;
    case "status-error":
      return `Could not check the payer: ${ready.error}\nCheck that the STELLAR_PRIVATE_KEY line in .env is complete and that you are online, then run again.`;
    case "no-account":
      return `The payer ${ready.publicKey} does not exist on testnet yet.\nFund it with test XLM:\n  ${wasitCommand} wallet fund --role x402 --asset xlm\nThen run again.`;
    case "no-usdc":
      return `The payer has no test USDC.\n${usdc(ready.publicKey, ready.hasTrustline)}\nIf you just used the faucet, wait a few seconds and run again.`;
    case "low-usdc":
      return `The payer holds ${ready.balance} USDC. A full run needs at least twice this seller's price (${price} in test USDC).\n${usdc(ready.publicKey, ready.hasTrustline)}\nThen run again.`;
    default:
      return "The payer is ready.";
  }
}

/** What the participant sees after the kit made a payer for them. Only the public address; the secret is never shown. */
export function payerCreatedText(address, { swapped = false, usdcBalance = 0 } = {}) {
  if (swapped) {
    return (
      `A test payer was created on Stellar testnet and funded with test XLM. It swapped ${SWAP_XLM} test XLM for about ${usdcBalance.toFixed(2)} test USDC on the public test exchange, so you do not need a faucet.\n` +
      `Address (public): ${address}\n` +
      `The address is also saved in payer-address.txt (public, safe to share).\n` +
      `Its secret key was saved in the .env file in this folder. It is never shown here: keep that file private, and never share or commit it.`
    );
  }
  return (
    `A test payer was created on Stellar testnet and funded with test XLM. It is ready to hold test USDC.\n` +
    `Address (public): ${address}\n` +
    `The address is also saved in payer-address.txt (public, safe to share).\n` +
    `Its secret key was saved in the .env file in this folder. It is never shown here: keep that file private, and never share or commit it.\n\n` +
    `Get test USDC for this address:\n` +
    `  1. Open ${FAUCET_URL}\n` +
    `  2. Choose Stellar Testnet\n` +
    `  3. Paste the address above\n` +
    `  4. Run npm run check:full`
  );
}

/**
 * Make a new test payer: a random key, funded with XLM by Friendbot, with a USDC trustline. The secret key is handed
 * to writeEnv(secret) ONLY after everything worked, so a failed attempt leaves nothing behind and the key is never
 * lost. It is never returned and never printed: the result is the public address. `stellar` carries the SDK pieces
 * as in ensureFullPayee. writeEnv must refuse to overwrite an existing file. `say(line)` gets the PAYER_PROGRESS lines
 * as the steps run, so the terminal is not silent while the network works. It is best effort: a throw or a rejected promise is ignored.
 */
export async function createPayer({ stellar, fetchImpl = fetch, writeEnv, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), say = (line) => console.log(line) }) {
  // Printing is best effort: a say that throws must never change what happens to the payer or its key.
  const tell = (line) => {
    try {
      const r = say(line);
      if (r && typeof r.then === "function") r.then(undefined, () => {}); // an async say that rejects must not crash the run either
    } catch {
      // nothing else to do
    }
  };
  const { Keypair, Horizon, TransactionBuilder, Operation, Asset, Networks, BASE_FEE } = stellar;
  const server = new Horizon.Server(TESTNET_HORIZON_URL);
  const keypair = Keypair.random();
  tell(PAYER_PROGRESS.friendbot);
  const fb = await fetchImpl(`${FRIENDBOT_URL}?addr=${encodeURIComponent(keypair.publicKey())}`, { signal: AbortSignal.timeout(30000) });
  if (!fb.ok) throw new Error(`Friendbot (the public testnet faucet for XLM) answered HTTP ${fb.status}. Try again in a minute.`);
  let account = null;
  for (let attempt = 0; attempt < 8 && !account; attempt++) {
    try {
      account = await server.loadAccount(keypair.publicKey());
    } catch {
      if (attempt === 0) tell(PAYER_PROGRESS.waiting); // once, and only when it really waits
      await sleep(1000);
    }
  }
  if (!account) throw new Error("The new payer account did not appear on testnet in time. Try again.");
  const usdc = new Asset("USDC", TESTNET_USDC_ISSUER);

  // Ask the public test exchange what SWAP_XLM would buy. destMin keeps the swap from running at a bad price.
  tell(PAYER_PROGRESS.quote);
  let quote = null;
  try {
    const found = await server.strictSendPaths(Asset.native(), SWAP_XLM, [usdc]).call();
    const best = found.records?.[0];
    const out = best ? Number(best.destination_amount) : 0;
    if (out >= 1) {
      quote = {
        destMin: (out * SWAP_MIN_SHARE).toFixed(7),
        path: (best.path ?? []).map((p) => (p.asset_type === "native" ? Asset.native() : new Asset(p.asset_code, p.asset_issuer))),
      };
    }
  } catch {
    quote = null; // no exchange answer: the faucet steps are the fallback
  }

  const build = (acc, withSwap) => {
    const b = new TransactionBuilder(acc, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET }).addOperation(Operation.changeTrust({ asset: usdc }));
    if (withSwap) {
      b.addOperation(
        Operation.pathPaymentStrictSend({ sendAsset: Asset.native(), sendAmount: SWAP_XLM, destination: keypair.publicKey(), destAsset: usdc, destMin: quote.destMin, path: quote.path }),
      );
    }
    const t = b.setTimeout(60).build();
    t.sign(keypair);
    return t;
  };

  let swapped = false;
  if (quote) {
    tell(PAYER_PROGRESS.swap);
    try {
      await server.submitTransaction(build(account, true)); // trustline and swap together: both or neither
      swapped = true;
    } catch {
      swapped = false; // slippage or an empty book: fall back to the trustline alone
    }
  }
  if (!swapped) {
    tell(quote ? PAYER_PROGRESS.swapFailed : PAYER_PROGRESS.noQuote);
    const fresh = await server.loadAccount(keypair.publicKey());
    await server.submitTransaction(build(fresh, false));
  }

  let usdcBalance = 0;
  if (swapped) {
    try {
      const done = await server.loadAccount(keypair.publicKey());
      usdcBalance = Number(done.balances.find((b) => b.asset_code === "USDC" && b.asset_issuer === TESTNET_USDC_ISSUER)?.balance ?? 0);
    } catch {
      usdcBalance = 0;
    }
  }
  writeEnv(keypair.secret());
  return { publicKey: keypair.publicKey(), swapped, usdcBalance };
}

/**
 * Make sure there is a payee that exists and trusts USDC. Creates a throwaway account when needed and DISCARDS its
 * secret key; only the public address is kept (project.fullPayee). `stellar` carries the SDK pieces:
 * { Keypair, Horizon, TransactionBuilder, Operation, Asset, Networks, BASE_FEE }. `save(project)` persists project.json.
 */
export async function ensureFullPayee({ project, stellar, fetchImpl = fetch, save, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  const { Keypair, Horizon, TransactionBuilder, Operation, Asset, Networks, BASE_FEE } = stellar;
  const server = new Horizon.Server(TESTNET_HORIZON_URL);
  const trusts = (account) => account.balances.some((b) => b.asset_code === "USDC" && b.asset_issuer === TESTNET_USDC_ISSUER);

  if (project.fullPayee) {
    try {
      if (trusts(await server.loadAccount(project.fullPayee))) return { payee: project.fullPayee, created: false };
    } catch {
      // not found or unreachable: set up a new one below
    }
  }

  const keypair = Keypair.random();
  const fb = await fetchImpl(`${FRIENDBOT_URL}?addr=${encodeURIComponent(keypair.publicKey())}`, { signal: AbortSignal.timeout(30000) });
  if (!fb.ok) throw new Error(`Friendbot (the public testnet faucet for XLM) answered HTTP ${fb.status}. Try again in a minute.`);

  let account = null;
  for (let attempt = 0; attempt < 8 && !account; attempt++) {
    try {
      account = await server.loadAccount(keypair.publicKey());
    } catch {
      await sleep(1000); // the new account can take a moment to appear
    }
  }
  if (!account) throw new Error("The new payee account did not appear on testnet in time. Try again.");

  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
    .addOperation(Operation.changeTrust({ asset: new Asset("USDC", TESTNET_USDC_ISSUER) }))
    .setTimeout(60)
    .build();
  tx.sign(keypair);
  await server.submitTransaction(tx);

  project.fullPayee = keypair.publicKey(); // the secret key is not kept anywhere: it goes out of scope here
  save(project);
  return { payee: project.fullPayee, created: true };
}
