// Exercise mode ("break and fix"): one challenge-level defect is written into the generated server.mjs as ordinary,
// plausible-looking code. The participant finds it from Wasit's report, opens the file and fixes it.
//
// The catalogue lives ONLY in this kit. A generated project gets the one chosen defect as code, plus a dotfile
// (.exercise.json) with the answer for `npm run exercise -- --hint` and `--reveal`. The defect's name appears in no
// other file of the project (a test asserts it).
//
// `expectedFailing` is what Wasit 0.7.0 really reports for the defect. It comes from running Wasit (see
// test/exercise-matrix.mjs), never from guessing. If a real run disagrees, this table is corrected or the defect is
// dropped; it is never edited to match what we would like to see.
//
// Payment-level defects (accept a replay, accept an underpayment) need custom verification code and are out of scope.

/** Statements that run inside cleanUp(res); res is { status, headers, body }. */
export const DEFECTS = [
  {
    id: "missing-header",
    title: "The payment header is removed",
    expectedFailing: ["X402-02"],
    hint: "Wasit says no payment header was found. Look at the code in server.mjs that touches the response headers.",
    explanation:
      "The clean-up code deletes the PAYMENT-REQUIRED header, so a client never learns the price or where to pay. X402-02 checks that the 402 carries a payment header, and X402-03 to 05 are skipped because there is nothing to read. Fix: remove the line that deletes the header.",
    body: `  // Headers we do not want to expose to clients.
  for (const name of ["payment-required"]) delete res.headers[name];`,
  },
  {
    id: "malformed-header",
    title: "The payment header is cut short",
    expectedFailing: ["X402-03"],
    hint: "The header is there, but Wasit cannot decode it. Look for code that changes the header's value.",
    explanation:
      "The clean-up code shortens the header value \"for the log\", which cuts the encoded value short (120 characters), so it no longer decodes to complete JSON. X402-03 checks that the header decodes to valid JSON, and X402-04 and 05 are skipped. Fix: stop shortening the value.",
    body: `  // Keep header values short so they fit in the access log.
  const value = res.headers["payment-required"];
  if (value) res.headers["payment-required"] = value.slice(0, 120);`,
  },
  {
    id: "status-200",
    title: "The paid route answers 200 instead of 402",
    expectedFailing: ["X402-01"],
    hint: "Wasit expected a 402 and got something else. Look at what happens to the response status.",
    explanation:
      "The clean-up code turns the 402 into a 200, so clients are not told to pay, and they still do not get the resource. X402-01 checks that an unpaid request is answered with exactly 402; the other checks are skipped because no challenge was issued. Fix: leave the status alone.",
    body: `  // Uptime monitors expect a 200 from every route.
  res.status = 200;`,
  },
  {
    id: "wrong-network-id",
    title: "The network name is not a valid identifier",
    expectedFailing: ["X402-05"],
    hint: "Everything decodes, but one value in the challenge is not written the way the protocol wants. Look at what the code does to the network.",
    explanation:
      "The clean-up code rewrites the network as stellar-testnet. The protocol (x402 v2) wants a CAIP-2 identifier (the standard name for a chain: a namespace, a colon, then the network, such as stellar:testnet). X402-05 checks that every advertised network is CAIP-2. Fix: keep the identifier as the library issued it.",
    body: `  // Show friendlier network names in the challenge.
  const challenge = decode(res.headers["payment-required"]);
  for (const option of challenge.accepts) option.network = option.network.replace(":", "-");
  res.headers["payment-required"] = encode(challenge);`,
  },
  {
    id: "missing-field",
    title: "A required field is missing from the challenge",
    expectedFailing: ["X402-04"],
    hint: "The header decodes, but the challenge is missing something a client needs in order to pay. Look at what the code removes from each option.",
    explanation:
      "The clean-up code deletes payTo from every payment option, so a client does not know who to pay. X402-04 checks that every required field (scheme, network, amount, asset, payTo, maxTimeoutSeconds) is present. Fix: stop removing the field.",
    body: `  // Slim down the challenge.
  const challenge = decode(res.headers["payment-required"]);
  for (const option of challenge.accepts) delete option.payTo;
  res.headers["payment-required"] = encode(challenge);`,
  },
  {
    id: "v1-body",
    title: "The challenge is in the body, in the old v1 style",
    expectedFailing: ["X402-02"],
    hint: "Wasit does not find a payment header, yet the response has payment information. Look at where the code puts the challenge.",
    explanation:
      "The clean-up code moves the challenge out of the PAYMENT-REQUIRED header and into the JSON body, which is how x402 v1 did it. x402 v2 puts the challenge in the header, and the exact scheme on Stellar is defined for v2 only. X402-02 fails because there is no header; Wasit still reads the body so you can see what was offered. Fix: leave the challenge in the header.",
    body: `  // Older clients read the challenge from the body, not from a header.
  const challenge = decode(res.headers["payment-required"]);
  res.body = JSON.stringify({
    x402Version: 1,
    error: "Payment required",
    accepts: challenge.accepts.map((a) => ({
      scheme: a.scheme,
      network: a.network,
      maxAmountRequired: a.amount,
      resource: challenge.resource?.url ?? "",
      description: challenge.resource?.description || "Paid resource",
      mimeType: "application/json",
      payTo: a.payTo,
      maxTimeoutSeconds: a.maxTimeoutSeconds,
      asset: a.asset,
    })),
  });
  delete res.headers["payment-required"];`,
  },
];

export const DEFECT_IDS = DEFECTS.map((d) => d.id);

export function defectById(id) {
  return DEFECTS.find((d) => d.id === id);
}

const COMMON = `// ---- response clean-up (added by the team) ----
const decode = (value) => JSON.parse(Buffer.from(value, "base64").toString("utf8"));
const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64");

// res is { status, headers, body }. Change it as needed and return it.
function cleanUp(res) {
__BODY__
  return res;
}
`;

const EXPRESS_HOOK = `
app.use((req, res, next) => {
  const end = res.end.bind(res);
  res.end = (chunk, ...rest) => {
    if (res.statusCode !== 402) return end(chunk, ...rest);
    const out = cleanUp({
      status: res.statusCode,
      headers: { "payment-required": res.getHeader("payment-required") },
      body: chunk ? chunk.toString() : "",
    });
    res.statusCode = out.status;
    const header = out.headers["payment-required"];
    if (header === undefined) res.removeHeader("payment-required");
    else res.setHeader("payment-required", header);
    res.setHeader("content-length", Buffer.byteLength(out.body));
    return end(out.body);
  };
  next();
});
`;

// Hono copies every header of the old response onto a response assigned to c.res, so a header must be changed on the
// OLD response first; building a new Response with different headers would be undone by that copy.
const HONO_HOOK = `
app.use(async (c, next) => {
  await next();
  if (c.res.status !== 402) return;
  const old = c.res;
  const out = cleanUp({
    status: old.status,
    headers: { "payment-required": old.headers.get("payment-required") ?? undefined },
    body: await old.clone().text(),
  });
  if (out.headers["payment-required"] === undefined) old.headers.delete("payment-required");
  else old.headers.set("payment-required", out.headers["payment-required"]);
  old.headers.delete("content-length");
  c.res = new Response(out.body, { status: out.status, headers: old.headers });
});
`;

/** The block inserted into server.mjs, right after the app is created and before the payment middleware. */
export function exerciseHook(framework, defect) {
  const adapter = framework === "hono" ? HONO_HOOK : EXPRESS_HOOK;
  return "\n" + COMMON.replace("__BODY__", defect.body) + adapter;
}

/** What goes in .exercise.json (the answer, read by scripts/exercise.mjs). */
export function exerciseAnswer(defect) {
  return {
    schemaVersion: 1,
    defect: defect.id,
    title: defect.title,
    hint: defect.hint,
    explanation: defect.explanation,
    expectedFailing: defect.expectedFailing,
  };
}
