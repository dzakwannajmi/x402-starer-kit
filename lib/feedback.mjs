// The feedback link a participant is shown after a run. It opens a NEW issue on the Wasit repository with the title
// and the questions already filled in; the participant writes the answers and pastes report.md themselves, from
// their own account. Nothing is collected, stored or sent by the kit. No imports: this file is copied into every
// generated project (scripts/feedback-lib.mjs).

export const FEEDBACK_REPO = "wasit-dev/Wasit";
export const FEEDBACK_TITLE = "User feedback (workshop kit): [your name or nickname, your choice]";

export const FEEDBACK_BODY = `Kind: workshop (practice kit, generated project)

Thank you for trying Wasit with the practice kit. Please write this yourself, from your own account, after the workshop. You choose what to share about results and problems.

## What did you try?
<!-- Which steps you ran: create the project, npm install, npm run check, npm run check:full. Which operating system and Node version. -->

## What happened?
<!-- Paste your whole report.md inside the first block below. If you ran npm run check:full, paste your whole report-full.md inside the second block. Paste nothing else: not .env, not project.json, not the output of wallet create. -->

<details><summary>My report.md</summary>

(paste the whole report.md here)

</details>

<details><summary>My report-full.md (only if you ran npm run check:full)</summary>

(paste the whole report-full.md here)

</details>

## What was confusing or slow?
<!-- Creating the project, the name prompt, npm install, npm run check, offline mode, npm run check:full, getting test USDC, reading the report. Be as direct as you like. -->

## What worked well?

## Would you run Wasit again on a service of your own? What would make that easier?

## What would you like Wasit or the kit to do next?
<!-- New checks, features, networks, integrations or practice exercises, and the problem each would solve for you. These are suggestions, not promises. -->

## Links
- Recording of our session: leave this empty. I add the link after the workshop, only if you agreed to it.

## Consent (tick what you agree to)
- [ ] You may quote this issue in Wasit's reports and documentation.
- [ ] You may link this issue as evidence of user feedback.

Never paste keys, a .env file, or the output of \`wallet create\`.
`;

// A filled-in sample, printed by `npm run feedback -- --example`. It is a pattern to copy, not a real answer.
export const FEEDBACK_EXAMPLE = `EXAMPLE (not real feedback): this shows how to fill in the form. Write your own answers.

Kind: workshop (practice kit, generated project)

## What did you try?
(Example answer.) Created a project with the kit, ran npm install and npm run check, then npm run check:full. macOS, Node 22.

## What happened?
(Example answer.) The read-only check passed with 5 checks, and the full run passed with 10. My reports are below.

<details><summary>My report.md</summary>

(In a real issue, the whole report.md goes here.)

</details>

<details><summary>My report-full.md (only if you ran npm run check:full)</summary>

(In a real issue, the whole report-full.md goes here.)

</details>

## What was confusing or slow?
(Example answer.) I did not know what to type at the name prompt. The full run stopped and told me I needed test USDC; the steps were clear but the faucet part took a few minutes.

## What worked well?
(Example answer.) One command made the project and one command checked it. The report was easy to read.

## Would you run Wasit again on a service of your own? What would make that easier?
(Example answer.) Yes, once I have a paid endpoint. A short guide for connecting my own service to the checks would help.

## What would you like Wasit or the kit to do next?
(Example answer.) More practice exercises, each with a different problem to find.

## Links
- Recording of our session: leave this empty. I add the link after the workshop, only if you agreed to it.

## Consent (tick what you agree to)
- [ ] You may quote this issue in Wasit's reports and documentation.
- [ ] You may link this issue as evidence of user feedback.
`;

export function buildFeedbackUrl() {
  const q = new URLSearchParams({ title: FEEDBACK_TITLE, body: FEEDBACK_BODY });
  return `https://github.com/${FEEDBACK_REPO}/issues/new?${q.toString()}`;
}
