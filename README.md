# x402 starter kit

A workshop kit. One command makes a small x402 seller of your own on your computer. Another command checks it with
Wasit, a tester for x402 payment services, and writes a report. Everything runs on test networks: no real money is
involved.

Wasit checks that a paid API follows the x402 protocol. It acts as a client: it asks the service for a resource, reads
the payment request the service sends back, and, if you let it, pays with test money and checks that the service also
refuses bad payments.

## Contents

- [What you need](#what-you-need)
- [Quick start](#quick-start)
- [The commands](#the-commands)
- [The full payment check](#the-full-payment-check)
- [Practice mode: find the planted defect](#practice-mode-find-the-planted-defect)
- [Reports](#reports)
- [Write your feedback](#write-your-feedback)
- [Safety](#safety)
- [If something goes wrong](#if-something-goes-wrong)
- [For maintainers](#for-maintainers)
- [What is not covered yet](#what-is-not-covered-yet)

## What you need

- Node.js 22 or newer (`node --version`).
- An internet connection. The first run downloads packages and Wasit.
- A terminal. Use your computer's terminal app, not the one inside a code editor, so that files stay in the folder you
  expect.

## Quick start

Make a new project (the name is yours to choose), install it and check it:

```bash
node kit.mjs new --name "My First Seller"
cd my-first-seller
npm install
npm run check
```

Without `--name` the kit asks you for one. The folder name is made from it. Write a project name you do not mind
showing in your reports and in any feedback you share.

`npm run check` starts your seller on `127.0.0.1`, runs Wasit's free read-only checks against it, writes
`report.md` and `report.json`, and prints a summary. It uses the public testnet facilitator when it can reach it, and
an offline stand-in when it cannot.

## The commands

Run these inside the project folder.

| Command | What it does |
| --- | --- |
| `npm start` | Starts your seller on `127.0.0.1` so you can look at it yourself |
| `npm run check` | Free checks X402-01 to 05: the payment request is well formed. No payment is made. Writes `report.md` and `report.json` |
| `npm run check -- --offline` | Same, with a local stand-in for the facilitator. Challenge checks only |
| `npm run check -- --online` | Same, but insists on the public testnet facilitator |
| `npm run check:full` | All 10 checks, including test payments. See below. Writes `report-full.md` and `report-full.json` |
| `npm run feedback` | Opens a new feedback issue with the questions already in place |
| `npm run feedback -- --example` | Prints a filled-in example first, to copy the shape from |
| `npm run exercise -- --hint` | Practice mode only: a nudge, without the answer |
| `npm run exercise -- --reveal` | Practice mode only: the answer |

After a successful `npm run check` in a terminal, the kit asks whether you want to run the full payment check now. Yes
makes your test payer right away (see the next section) and tells you what to do next. No prints the command to write
your feedback.

Options of `node kit.mjs new`:

| Option | Meaning |
| --- | --- |
| `--name "..."` | Your project name |
| `--framework express\|hono` | The server framework. Default: picked from the seed |
| `--method GET\|POST` | The HTTP method of the paid route. Default: picked from the seed |
| `--seed <number>` | Makes the same project again (path, theme and price come from the seed) |
| `--dir <folder>` | The folder to create the project in |
| `--exercise [--defect <id>]` | Practice mode, see below |

## The full payment check

`npm run check:full` runs all 10 checks. X402-06 pays your seller once with test USDC from a test payer, and
X402-07 to 10 send four payments your seller must refuse (a corrupted signature, a repeated payment, an
underpayment and an expired authorization). The price is shown before it starts. It uses test funds only, on Stellar
testnet, and needs the public testnet facilitator.

You need a test payer that holds test USDC. The kit makes one for you:

1. Answer yes to the question after `npm run check`, or run `npm run check:full`. If the project has no payer yet and
   no `.env` file, the kit creates one on testnet: a new key, test XLM, and a USDC trustline. It then swaps 10 test
   XLM for about 8 or 9 test USDC on the public test exchange, so you do not need a faucet. The secret key is saved in
   `.env` in your project folder and is never shown. The public address is shown in the terminal and saved in
   `payer-address.txt`, which is safe to share.
2. If you answered yes after `npm run check`, run `npm run check:full` now. If you ran `check:full` directly, it carries
   on with the full run by itself.
3. If the swap cannot be done (the test exchange had no price, or it failed), the kit says so and shows the manual
   steps: get test USDC at https://faucet.circle.com (choose Stellar Testnet, paste the address), then run
   `npm run check:full`.

The payee, the account that receives the payment, is a throwaway account made by the kit. Its secret key is thrown
away as soon as it is set up, so nobody can spend from it.

If you already have a `.env` file, the kit does not touch it and gives you manual steps instead. A full run needs the
payer to hold at least twice the seller's price.

## Practice mode: find the planted defect

```bash
node kit.mjs new --name "Fix Me" --exercise
cd fix-me
npm install
npm run check
```

In practice mode one defect is written into `server.mjs` on purpose. Run `npm run check`, read the report, find the
problem and fix it. When no check fails, the exercise says it is solved. `npm run exercise -- --hint` gives a nudge and
`npm run exercise -- --reveal` shows the answer. The full payment check is only allowed after the exercise is solved.

## Reports

| File | Made by | Contains |
| --- | --- | --- |
| `report.md`, `report.json` | `npm run check` | The five free checks, each PASS, FAIL, SKIP or ERROR with Wasit's reason |
| `report-full.md`, `report-full.json` | `npm run check:full` | All ten checks, with the payment proof in the X402-06 row (amount, payee, masked transaction hash) |

The report is built by code from Wasit's own output. The kit never decides a result and nothing is written by a model.
Keys and long hex values are masked.

Read a report like this: PASS means the check passed; FAIL means the service did not behave as the check requires;
SKIP means the check did not run and the line says why; ERROR means Wasit could not reach a result. A read-only run
says in its report that payment handling was not checked.

A report describes this generated practice project only. It is not a certificate and not a security review.

## Write your feedback

After the workshop, please write your feedback yourself as a GitHub issue, from your own account:

```bash
npm run feedback
```

This prints a web address and tries to open it. It starts a new issue with the questions already in place. Paste your
whole `report.md` (and `report-full.md` if you ran the full check) in the blocks, and answer the questions in your own
words. The kit sends nothing.

Paste only the reports. Never paste a `.env` file, `project.json`, or any key.

## Safety

- Testnet only. No real money is involved. The kit only checks the seller it made on your own computer.
- Your seller listens on `127.0.0.1` only, so other computers cannot reach it.
- The payer key lives only in `.env` in your project folder (on macOS and Linux readable by you alone), and `.env` is in `.gitignore`.
  Keep it private, never share or commit it, and use it for test money only.
- Packages are pinned to exact versions and install scripts are switched off (`.npmrc`).
- `axios`, used inside the Stellar SDK, is pinned to a patched version through `overrides` in each project's
  `package.json`, so `npm install` reports no known vulnerabilities (checked 2026-10-19). Do not run `npm audit fix --force`:
  it would change the pinned versions the x402 libraries need.
- The project name you type is data. It is cleaned and is never written into code or used as a path.
- Do not point Wasit at a service run by someone else without that operator's written permission.

## If something goes wrong

| You see | Do this |
| --- | --- |
| "Node.js 22 or newer is required" | Install Node.js 22 or newer and run the command again |
| "The seller did not start" | Run `npm install` in the project folder first, then try again |
| X402-01 FAIL and a message about the facilitator | Check your internet connection, or run `npm run check -- --offline` |
| `Missing script: "feedback"` | Your project was made with an older kit. Make a new one with `node kit.mjs new` |
| `check:full` says the payer has no USDC | Use the faucet steps it prints, wait a few seconds, run it again |
| X402-10 shows ERROR with "signature has expired" | Run `npm run check:full` again. This happened in about half of the runs we tried on 2026-10-19 and passed on the next run; the cause is being looked at |

## For maintainers

- Run the unit tests: `npm test`.
- Real end-to-end runs from empty folders (they need internet): `node test/matrix.mjs` runs ten scenarios across both
  frameworks, both methods and online and offline modes. `node test/exercise-matrix.mjs` runs the twelve practice
  scenarios (each defect broken, then fixed).
- Freeze one version before a workshop and share it with `git clone` or `git archive`, not by zipping a working folder.
  A project made earlier does not get updates: it is a copy.
- Wasit runs through `npx` at a pinned version (`WASIT_VERSION` in `templates/common/check.mjs.tpl`), outside the
  project's own dependencies, because its dependency tree would clash with the one the x402 libraries use.

Layout: `kit.mjs` is the command; `lib/` has the generator, report builder, names, facilitator, full-run and feedback
helpers; `templates/` has the files written into each project; `test/` has the unit tests and the end-to-end runs.

## What is not covered yet

- Windows has not been run.
- The kit has not been used by a workshop participant yet.
- Only `stellar:testnet` is supported.
- How the pre-filled feedback issue looks on GitHub, and the browser opening on Windows, are not verified.
