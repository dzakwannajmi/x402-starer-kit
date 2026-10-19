// What the participant is told to do after a check, and the yes/no question that decides it. No imports: this file
// is copied into every generated project (scripts/nextsteps.mjs). The words are fixed here; the kit never decides
// anything about the result, only which command to point to.

export const FULL_QUESTION =
  "Do you want to run the full payment check now? It sends test payments on Stellar testnet and needs a funded test payer. (yes/no) ";

export const TEXT = {
  runFull: "After you have test USDC, you must run this command to run the full payment check:\n  npm run check:full\nWhen it is done, run npm run feedback to write your feedback.",
  runFeedback: "You must run this command to write your feedback:\n  npm run feedback",
  both:
    "Next:\n  1. npm run check:full   (full payment check; test payments on Stellar testnet, needs a funded test payer)\n  2. npm run feedback     (write your feedback)",
};

/** "yes", "y", "no", "n" in any case; anything else is null. */
export function parseYesNo(answer) {
  const a = String(answer ?? "").trim().toLowerCase();
  if (a === "y" || a === "yes") return true;
  if (a === "n" || a === "no") return false;
  return null;
}

/**
 * Should the question be asked? Only after a finished read-only run that came out conformant, in a real terminal.
 * A failing run, an unsolved exercise, a full run, a pipe or a CI run get no question.
 */
export function shouldAsk({ full, outcome, exerciseUnsolved, interactive }) {
  return !full && outcome === "conformant" && !exerciseUnsolved && Boolean(interactive);
}

/**
 * The closing text. `answeredYes` is true, false, or undefined when no question was asked.
 * Full run: feedback. Read-only, conformant, not asked (pipe, CI): both steps. Asked: the one the answer chose.
 */
export function nextStepsText({ full, outcome, exerciseUnsolved, answeredYes }) {
  if (full) return TEXT.runFeedback;
  if (outcome !== "conformant" || exerciseUnsolved) return null;
  if (answeredYes === true) return TEXT.runFull;
  if (answeredYes === false) return TEXT.runFeedback;
  return TEXT.both;
}
