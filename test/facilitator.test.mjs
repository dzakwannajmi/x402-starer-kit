import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import {
  DEFAULT_FACILITATOR_URL,
  STELLAR_TESTNET_KIND,
  chooseFacilitatorMode,
  probeFacilitator,
  startStubFacilitator,
} from "../lib/facilitator.mjs";

test("mode decision table", () => {
  const D = DEFAULT_FACILITATOR_URL;
  assert.deepEqual(chooseFacilitatorMode({ reachable: true }), { mode: "real", url: D });
  assert.deepEqual(chooseFacilitatorMode({ reachable: false }), { mode: "stub" });
  assert.deepEqual(chooseFacilitatorMode({ offline: true, reachable: true }), { mode: "stub" });
  assert.deepEqual(chooseFacilitatorMode({ online: true, reachable: false }), { mode: "real", url: D });
  // a URL the participant chose is never replaced, whatever the flags or the probe say
  assert.deepEqual(chooseFacilitatorMode({ envUrl: "http://example.test/f", offline: true, reachable: false }), {
    mode: "custom",
    url: "http://example.test/f",
  });
  assert.throws(() => chooseFacilitatorMode({ offline: true, online: true }), /not both/);
});

function listen(handler) {
  return new Promise((resolve) => {
    const s = http.createServer(handler);
    s.listen(0, "127.0.0.1", () => resolve({ s, url: `http://127.0.0.1:${s.address().port}` }));
  });
}

test("probe: true for a 200, false for an error status, false for a closed port, and fast", async () => {
  const ok = await listen((_q, r) => r.end("{}"));
  const bad = await listen((_q, r) => {
    r.statusCode = 500;
    r.end();
  });
  assert.equal(await probeFacilitator(ok.url, 2000), true);
  assert.equal(await probeFacilitator(bad.url, 2000), false);
  const started = Date.now();
  assert.equal(await probeFacilitator("http://127.0.0.1:9/supported", 2000), false);
  assert.ok(Date.now() - started < 2500);
  ok.s.close();
  bad.s.close();
});

test("the stand-in answers /supported with the Stellar testnet kind and refuses everything else", async () => {
  const stub = await startStubFacilitator();
  assert.match(stub.url, /^http:\/\/127\.0\.0\.1:\d+$/); // local only
  const res = await fetch(`${stub.url}/supported`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.kinds, [STELLAR_TESTNET_KIND]);
  assert.equal(body.kinds[0].network, "stellar:testnet");
  assert.equal(body.kinds[0].x402Version, 2);
  for (const [method, p] of [["POST", "/verify"], ["POST", "/settle"], ["GET", "/other"]]) {
    const r = await fetch(`${stub.url}${p}`, { method });
    assert.equal(r.status, 501, `${method} ${p} must not be served`);
  }
  await stub.close();
  await assert.rejects(fetch(`${stub.url}/supported`, { signal: AbortSignal.timeout(1000) }));
});

test("the stand-in only ever advertises Stellar testnet", () => {
  assert.equal(STELLAR_TESTNET_KIND.network, "stellar:testnet");
  assert.ok(!/pubnet|mainnet/i.test(JSON.stringify(STELLAR_TESTNET_KIND)));
});
