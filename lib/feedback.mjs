// The feedback link a participant is shown after a run. It opens a NEW issue on the Wasit repository with the title
// and the questions already filled in; the participant writes the answers and pastes report.md themselves, from
// their own account. Nothing is collected, stored or sent by the kit. No imports: this file is copied into every
// generated project (scripts/feedback-lib.mjs).

export const FEEDBACK_REPO = "wasit-dev/Wasit";
export const FEEDBACK_TITLE = "User feedback (workshop kit): [your name or nickname, your choice]";

// The questions, with no instructions to delete: the headings are the form. The report summaries are added by code
// from the participant's own report.json files (see buildFeedbackBody).
const QUESTIONS_AFTER_REPORT = `

## What was confusing or slow?

## What worked well?

## Would you run Wasit again on a service of your own? What would make that easier?

## What would you like Wasit or the kit to do next?

## Consent (tick what you agree to)
- [ ] You may quote this issue in Wasit's reports and documentation.
- [ ] You may link this issue as evidence of user feedback.

Never paste keys, a .env file, or the output of \`wallet create\`.
`;

const MAX_URL = 6500; // well under what GitHub accepts in an address (not verified; kept small on purpose)

/**
 * A short, readable summary of one report.json, built by code from what Wasit reported. The long Wasit detail is left
 * out, except the payment line of X402-06, which is the proof that a payment settled.
 */
export function summarizeReport(report, { withPaymentLine = true } = {}) {
  if (!report || typeof report !== "object" || !Array.isArray(report.results)) return "";
  const c = report.counts ?? {};
  const lines = [
    `${report.wasit?.mode === "full" ? "Full payment check" : "Read-only check"}, Wasit ${report.wasit?.version ?? "?"}, ${report.generatedAt ?? ""}`,
    `Result: ${report.outcome}: ${c.passed ?? 0} passed, ${c.failed ?? 0} failed, ${c.errored ?? 0} no verdict, ${c.skipped ?? 0} skipped`,
    ...report.results.map((r) => `${String(r.status).padEnd(5)} ${r.id}  ${r.name}`),
  ];
  const pay = report.results.find((r) => r.id === "X402-06");
  if (withPaymentLine && pay?.status === "PASS" && pay.detail) lines.push("", `X402-06: ${String(pay.detail).slice(0, 300)}`);
  return lines.join("\n");
}

function block(title, text) {
  return text ? `<details><summary>${title}</summary>\n\n\`\`\`text\n${text}\n\`\`\`\n\n</details>\n` : "";
}

/** The body of the new issue: the participant's report summaries already in place, then the questions. */
export function buildFeedbackBody({ readOnly = null, full = null, withPaymentLine = true } = {}) {
  const blocks = [
    block("My report (npm run check)", summarizeReport(readOnly, { withPaymentLine })),
    block("My report (npm run check:full)", summarizeReport(full, { withPaymentLine })),
  ].filter(Boolean);
  return `## What did you try?\n\n## What happened?\n${blocks.length ? "\n" + blocks.join("\n") : ""}${QUESTIONS_AFTER_REPORT}`;
}

// Used by tests and by --example: the form with no report in it.
export const FEEDBACK_BODY = buildFeedbackBody();

// A filled-in sample, printed by `npm run feedback -- --example`. It is a pattern to copy, not a real answer.
export const FEEDBACK_EXAMPLE = `EXAMPLE (not real feedback): this shows how to fill in the form. Write your own answers.

## What did you try?
(Example answer.) Created a project with the kit, ran npm install and npm run check, answered yes, then npm run check:full. macOS, Node 22.

## What happened?
(Example answer.) Both checks passed. My report summaries are filled in for you by npm run feedback.

## What was confusing or slow?
(Example answer.) I did not know what to type at the name prompt. The swap to test USDC took a few seconds.

## What worked well?
(Example answer.) One command made the project and one command checked it. The report was easy to read.

## Would you run Wasit again on a service of your own? What would make that easier?
(Example answer.) Yes, once I have a paid endpoint. A short guide for connecting my own service to the checks would help.

## What would you like Wasit or the kit to do next?
(Example answer.) More practice exercises, each with a different problem to find.

## Consent (tick what you agree to)
- [ ] You may quote this issue in Wasit's reports and documentation.
- [ ] You may link this issue as evidence of user feedback.
`;

/**
 * The new-issue address. If it would be too long, the payment line goes first, then the report summaries.
 */
export function buildFeedbackUrl({ readOnly = null, full = null } = {}) {
  const make = (opts) => `https://github.com/${FEEDBACK_REPO}/issues/new?${new URLSearchParams({ title: FEEDBACK_TITLE, body: buildFeedbackBody(opts) }).toString()}`;
  for (const opts of [{ readOnly, full }, { readOnly, full, withPaymentLine: false }, { readOnly: null, full }, { readOnly: null, full: null }]) {
    const url = make(opts);
    if (url.length <= MAX_URL) return url;
  }
  return make({});
}
