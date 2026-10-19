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
<!-- Paste your whole report.md inside the block below. Paste nothing else: not .env, not project.json, not the output of wallet create. -->

<details><summary>My report.md</summary>

(paste the whole report.md here)

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

export function buildFeedbackUrl() {
  const q = new URLSearchParams({ title: FEEDBACK_TITLE, body: FEEDBACK_BODY });
  return `https://github.com/${FEEDBACK_REPO}/issues/new?${q.toString()}`;
}
