// Builds the report from Wasit's own JSON. A status, an outcome and a count are COPIED from Wasit, never decided
// here and never written by a model. If Wasit's output cannot be read, the report says so instead of guessing.
// This file is also copied into every generated project (scripts/report.mjs), so it imports nothing.

export const DISCLAIMER =
  "Generated demo project, not a real service. Results describe this generated code only. Testnet only. Not a certificate or an audit.";

export const FULL_NOTE =
  "Full run: all 10 checks ran. Test funds moved on Stellar testnet, from your payer to a throwaway payee account that nobody can spend from.";
export const STUB_NOTE =
  "Offline mode: a local stand-in answered the facilitator's /supported call, so no internet was needed. Payment checks are not possible in this mode; a pass means the payment challenge is well formed.";

const KNOWN_STATUS = new Set(["PASS", "FAIL", "SKIP", "ERROR"]);

/** Shorten any 64-hex value (tx hashes) and anything that looks like a Stellar secret key. */
export function maskSecrets(text) {
  return String(text)
    .replace(/\bS[A-Z2-7]{55}\b/g, "S<masked>")
    .replace(/\b(0x)?([0-9a-fA-F]{6})[0-9a-fA-F]{54}([0-9a-fA-F]{4})\b/g, (_m, p, a, b) => `${p ?? ""}${a}...${b}`); // 6 + 54 + 4 = 64
}

function oneLine(text, max = 300) {
  return maskSecrets(String(text ?? "")).replace(/\s+/g, " ").trim().slice(0, max);
}

/**
 * Exercise status, computed by code from what Wasit reported (never by a model).
 *   solved           no check failed and none could not run
 *   defect-present   exactly the checks the exercise started with are failing
 *   different        something else is failing (the participant may have changed another thing)
 *   unknown          the checks did not run properly, so no statement is made
 */
export function exerciseStatus(exercise, report) {
  if (!exercise) return null;
  const expectedFailing = [...exercise.expectedFailing].sort();
  const observedFailing = report.results.filter((x) => x.status === "FAIL").map((x) => x.id).sort();
  let status;
  if (report.outcome === "harness-error" || report.counts.errored > 0) status = "unknown";
  else if (observedFailing.length === 0) status = "solved";
  else if (JSON.stringify(observedFailing) === JSON.stringify(expectedFailing)) status = "defect-present";
  else status = "different";
  return { status, expectedFailing, observedFailing };
}

/**
 * input: { project, wasit: { version, command }, facilitator: { mode, url }, kitVersion, generatedAt,
 *          wasitJson (parsed object or null), harnessError (string or null),
 *          exercise ({ expectedFailing } or null), full (true for a full run) }
 */
export function buildReport(input) {
  const report = buildBase(input);
  report.exercise = exerciseStatus(input.exercise ?? null, report);
  return report;
}

function buildBase(input) {
  const { project, wasit, facilitator, kitVersion, generatedAt, wasitJson, harnessError } = input;
  const base = {
    schemaVersion: 1,
    generatedAt,
    kind: "generated-demo-project",
    kit: { version: kitVersion },
    project: {
      name: project.name,
      seed: project.seed,
      variant: project.variant,
    },
    facilitator,
    wasit: { version: wasit.version, mode: input.full ? "full" : "read-only", command: wasit.command },
    exercise: null,
    notes: facilitator.mode === "stub" ? [STUB_NOTE] : input.full ? [FULL_NOTE] : [],
    disclaimer: DISCLAIMER,
  };

  const valid =
    wasitJson &&
    typeof wasitJson === "object" &&
    typeof wasitJson.outcome === "string" &&
    Array.isArray(wasitJson.results) &&
    wasitJson.results.every((r) => r && typeof r.id === "string" && KNOWN_STATUS.has(r.status));

  if (!valid) {
    return {
      ...base,
      outcome: "harness-error",
      counts: { passed: 0, failed: 0, errored: 0, skipped: 0 },
      results: [],
      error: oneLine(harnessError || "Wasit did not return readable JSON."),
    };
  }

  return {
    ...base,
    outcome: wasitJson.outcome,
    counts: {
      passed: Number(wasitJson.passed) || 0,
      failed: Number(wasitJson.failed) || 0,
      errored: Number(wasitJson.errored) || 0,
      skipped: Number(wasitJson.skipped) || 0,
    },
    results: wasitJson.results.map((r) => ({
      id: r.id,
      name: String(r.name ?? ""),
      status: r.status,
      detail: oneLine(r.detail),
    })),
  };
}

function oneLineName(name) {
  return String(name).replace(/[\r\n]+/g, " ");
}

function summary(r) {
  if (r.outcome === "harness-error") return "No result: the check could not run.";
  const { passed, failed, errored, skipped } = r.counts;
  return `${r.outcome}: ${passed} passed, ${failed} failed, ${errored} could not run, ${skipped} skipped`;
}

function variantText(v) {
  return `${v.framework}, ${v.method ?? "GET"} ${v.path ?? "/paid"}, ${v.resource}, price ${v.price}, ${v.network}`;
}

function exerciseText(e) {
  const failing = e.observedFailing.join(", ") || "none";
  switch (e.status) {
    case "solved":
      return "Solved: all checks pass. Run `npm run exercise -- --reveal` to see what the defect was.";
    case "defect-present":
      return `The seeded defect is still there (failing: ${failing}). Find it in server.mjs and fix it. Stuck? Run \`npm run exercise -- --hint\`.`;
    case "different":
      return `The failing checks (${failing}) are not the ones the exercise started with. You may have changed something else. Run \`npm run exercise -- --hint\`.`;
    default:
      return "Cannot tell: the checks did not run properly.";
  }
}

/** Plain text for the terminal. The name was cleaned at creation time; it is flattened to one line here as well. */
export function renderTerminal(r) {
  const lines = [
    `Project   ${oneLineName(r.project.name)}   (generated demo, ${variantText(r.project.variant)}, seed ${r.project.seed})`,
    `Wasit     ${r.wasit.version}, ${r.wasit.mode}   (facilitator: ${r.facilitator.mode})`,
    `Result    ${summary(r)}`,
    ...r.results.map((x) => `  ${x.status.padEnd(5)} ${x.id}  ${x.name}`),
  ];
  if (r.error) lines.push(`Error     ${r.error}`);
  if (r.exercise) lines.push(`Exercise  ${exerciseText(r.exercise)}`);
  for (const n of r.notes ?? []) lines.push(`Mode      ${n}`);
  lines.push(`Note      ${r.disclaimer}`);
  return lines.join("\n");
}

/** Escape text for inline Markdown (names and Wasit details are shown in report.md). */
export function mdEscape(text) {
  return String(text).replace(/[\\`*_{}\[\]<>()#+!|~]/g, (c) => `\\${c}`);
}

export function renderMarkdown(r) {
  const rows = r.results.map((x) => `| ${x.id} | ${mdEscape(x.name)} | ${x.status} | ${mdEscape(x.detail)} |`);
  return [
    `# Wasit report: ${mdEscape(oneLineName(r.project.name))}`,
    "",
    `> ${r.disclaimer}`,
    "",
    "## Summary",
    "",
    `- **Result:** ${summary(r)}`,
    `- **Generated at:** ${r.generatedAt}`,
    `- **Wasit:** ${r.wasit.version}, ${r.wasit.mode}`,
    `- **Facilitator:** ${r.facilitator.mode}`,
    `- **Variant:** ${variantText(r.project.variant)}, seed ${r.project.seed}`,
    ...(r.notes ?? []).map((n) => `- **Mode:** ${n}`),
    ...(r.exercise ? [`- **Exercise:** ${exerciseText(r.exercise)}`] : []),
    "",
    "## Checks",
    "",
    r.results.length ? "| ID | Check | Status | Detail |\n| --- | --- | --- | --- |\n" + rows.join("\n") : "No check results.",
    "",
    ...(r.error ? ["## Error", "", mdEscape(r.error), ""] : []),
    "## Command",
    "",
    "```text",
    r.wasit.command,
    "```",
    "",
  ].join("\n");
}
