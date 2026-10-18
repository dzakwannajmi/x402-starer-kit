// Facilitator handling for the generated project (copied to scripts/facilitator.mjs). Uses only Node built-ins.
//
// Why this exists: an x402 seller built with the official libraries asks the facilitator what it supports BEFORE it
// can issue any 402. With no internet the first request answers HTTP 500 and every check fails. In offline mode a
// tiny local stand-in answers only GET /supported, which is enough for the seller to build a well formed challenge.
// It cannot verify or settle a payment: every other route answers 501. Reports say so.
import http from "node:http";

export const DEFAULT_FACILITATOR_URL = "https://www.x402.org/facilitator";

// The Stellar testnet entry of the public facilitator's /supported answer (captured 2026-10-18).
export const STELLAR_TESTNET_KIND = {
  x402Version: 2,
  scheme: "exact",
  network: "stellar:testnet",
  extra: { areFeesSponsored: true },
};

/**
 * Pick the facilitator mode. Pure function, so it is easy to test.
 *   env URL set        -> "custom" (the participant chose it; never overridden)
 *   --offline          -> "stub"
 *   --online           -> "real"
 *   otherwise          -> "real" when the probe reached the facilitator, else "stub"
 */
export function chooseFacilitatorMode({ envUrl, offline, online, reachable }) {
  if (offline && online) throw new Error("Use either --offline or --online, not both.");
  if (envUrl) return { mode: "custom", url: envUrl };
  if (offline) return { mode: "stub" };
  if (online) return { mode: "real", url: DEFAULT_FACILITATOR_URL };
  return reachable ? { mode: "real", url: DEFAULT_FACILITATOR_URL } : { mode: "stub" };
}

/** True when the facilitator's /supported answers within the time limit. */
export async function probeFacilitator(url, timeoutMs = 4000) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    return res.ok;
  } catch {
    return false;
  }
}

/** Start the local stand-in on a free 127.0.0.1 port. Resolves { url, close() }. */
export function startStubFacilitator() {
  const supported = { kinds: [STELLAR_TESTNET_KIND], extensions: [], signers: {} };
  const server = http.createServer((req, res) => {
    if (req.method === "GET" && req.url === "/supported") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(supported));
    } else {
      res.writeHead(501, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "offline stand-in: verify and settle are not available" }));
    }
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ url: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(() => r())) });
    });
  });
}
