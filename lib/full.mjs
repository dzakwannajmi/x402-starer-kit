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
  if (!(balance > 0)) return { ok: false, reason: "no-usdc", publicKey, balance: 0 };
  // One payment settles in X402-06; the refused ones that follow should fail for their own reason, not for lack of funds.
  if (balance < 2 * priceUsdc) return { ok: false, reason: "low-usdc", publicKey, balance };
  return { ok: true, publicKey, balance };
}

/** What to tell the participant when the payer is not ready. Never contains a key; only public addresses. */
export function payerHelp(ready, { price, wasitCommand }) {
  const create =
    `Create a test payer:\n  ${wasitCommand} wallet create --role x402 --fund\n` +
    `It prints your new secret key on screen, so do not run it while you share or record your screen.\n` +
    `Copy the one line that starts with STELLAR_PRIVATE_KEY= into a file named .env in this project folder.\n` +
    `That key is yours: keep it private, never share or commit it, and use it for test money only.`;
  const usdc = (addr) =>
    `Get test USDC:\n  1. ${wasitCommand} wallet fund --role x402 --asset usdc   (lets the payer hold USDC: it adds a trustline)\n` +
    `  2. Open ${FAUCET_URL}, choose Stellar Testnet and paste this address:\n     ${addr}\n` +
    `The faucet step is manual: there is no scriptable USDC faucet for Stellar testnet.`;
  switch (ready.reason) {
    case "not-configured":
      return `No test payer found.\n${create}\nThen get test USDC (the next run tells you how), and run again.`;
    case "status-error":
      return `Could not check the payer: ${ready.error}\nCheck that the STELLAR_PRIVATE_KEY line in .env is complete and that you are online, then run again.`;
    case "no-account":
      return `The payer ${ready.publicKey} does not exist on testnet yet.\nFund it with test XLM:\n  ${wasitCommand} wallet fund --role x402 --asset xlm\nThen run again.`;
    case "no-usdc":
      return `The payer has no test USDC.\n${usdc(ready.publicKey)}\nIf you just used the faucet, wait a few seconds and run again.`;
    case "low-usdc":
      return `The payer holds ${ready.balance} USDC. A full run needs at least twice this seller's price (${price} in test USDC).\n${usdc(ready.publicKey)}\nThen run again.`;
    default:
      return "The payer is ready.";
  }
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
