// The project name is typed by the participant, so it is untrusted input. It is DATA only: it is never written
// into code and never used as a path. The folder name is a separate, safe slug derived from it.

export const MAX_DISPLAY = 60;
export const MAX_SLUG = 40;

const RESERVED_WINDOWS = new Set([
  "con", "prn", "aux", "nul", "com0", "lpt0",
  ...Array.from({ length: 9 }, (_, i) => `com${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `lpt${i + 1}`),
]);

/** Trim, drop ANSI escapes, control characters and invisible direction/zero-width characters, collapse spaces. */
export function cleanDisplayName(input) {
  let s = String(input ?? "");
  s = s
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "") // ANSI CSI sequences
    .replace(/\u001b[\s\S]?/g, "") // any other lone ESC and the character after it
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ") // control characters become a space
    .replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u2069\u061c]/g, "") // zero-width and bidi controls
    .replace(/\s+/g, " ")
    .trim();
  return Array.from(s).slice(0, MAX_DISPLAY).join("").trim();
}

/** Folder-safe slug: a-z 0-9 . _ - only, no leading or trailing separators, no "..", not a Windows device name. */
export function slugify(name) {
  let s = cleanDisplayName(name)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip accents
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/[-._]{2,}/g, "-") // any run of separators becomes one dash: no "..", no "-.-"
    .replace(/^[-._]+|[-._]+$/g, "");
  s = s.slice(0, MAX_SLUG).replace(/^[-._]+|[-._]+$/g, "");
  if (!s) return "project";
  if (RESERVED_WINDOWS.has(s.split(".")[0])) return `project-${s}`;
  return s;
}

/** { ok, display, slug } or { ok: false, reason }. A name with nothing usable left is rejected. */
export function checkName(input) {
  const display = cleanDisplayName(input);
  if (!display) return { ok: false, reason: "empty" };
  // checked on the whole input: the display name is cut to 60 characters, which could hide a 64-character key
  if (/(?<![A-Z2-7])S[A-Z2-7]{55}(?![A-Z2-7])/.test(String(input)) || /[0-9a-fA-F]{64}/.test(String(input))) return { ok: false, reason: "secret-like" };
  if (!/[\p{L}\p{N}]/u.test(display)) return { ok: false, reason: "no-letters-or-digits" };
  // A key pasted at the prompt must never end up in project.json or a report.
  if (/(?<![A-Z2-7])S[A-Z2-7]{55}(?![A-Z2-7])/.test(display) || /[0-9a-fA-F]{64}/.test(display)) return { ok: false, reason: "secret-like" };
  return { ok: true, display, slug: slugify(display) };
}
