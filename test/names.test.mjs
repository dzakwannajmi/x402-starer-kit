import test from "node:test";
import assert from "node:assert/strict";
import { checkName, cleanDisplayName, slugify, MAX_DISPLAY, MAX_SLUG } from "../lib/names.mjs";

test("path traversal and separators never survive in the slug", () => {
  assert.equal(slugify("../../evil"), "evil");
  assert.equal(slugify("/etc/passwd"), "etc-passwd");
  assert.equal(slugify("C:\\Windows\\System32"), "c-windows-system32");
  assert.equal(slugify("a/../b"), "a-b");
  assert.ok(!slugify("..").includes(".."));
});

test("slug never starts or ends with a dot, dash or underscore", () => {
  assert.equal(slugify(".hidden"), "hidden");
  assert.equal(slugify("name..."), "name");
  assert.equal(slugify("__init__"), "init");
  assert.equal(slugify("a..b"), "a-b");
  assert.equal(slugify("a.b"), "a.b"); // a single dot inside a name is fine
});

test("Windows device names are not used as folder names", () => {
  for (const n of ["CON", "nul", "Com1", "LPT9", "aux", "PRN"]) {
    assert.match(slugify(n), /^project-/, n);
  }
  assert.equal(slugify("nul.txt"), "project-nul.txt");
});

test("ANSI escapes, control and direction characters are stripped from the display name", () => {
  assert.equal(cleanDisplayName("\u001b[31mred\u001b[0m"), "red");
  assert.equal(cleanDisplayName("a\nb\tc"), "a b c");
  assert.equal(cleanDisplayName("ab\u202ecd"), "abcd");
  assert.equal(cleanDisplayName("x\u0000y"), "x y");
  assert.equal(cleanDisplayName("  many   spaces  "), "many spaces");
});

test("length limits", () => {
  const long = "a".repeat(200);
  assert.equal(Array.from(cleanDisplayName(long)).length, MAX_DISPLAY);
  assert.ok(slugify(long).length <= MAX_SLUG);
});

test("accents are folded and unusual scripts fall back to a safe slug", () => {
  assert.equal(slugify("Café Çok"), "cafe-cok");
  assert.equal(checkName("日本語").ok, true);
  assert.equal(checkName("日本語").slug, "project");
});

test("empty, blank and symbol-only names are rejected", () => {
  assert.equal(checkName("").ok, false);
  assert.equal(checkName("   ").ok, false);
  assert.equal(checkName("...").ok, false);
  assert.equal(checkName("***").ok, false);
  assert.equal(checkName(undefined).ok, false);
});

test("the display name keeps the participant's own wording", () => {
  const c = checkName("  My First x402!  ");
  assert.equal(c.ok, true);
  assert.equal(c.display, "My First x402!");
  assert.equal(c.slug, "my-first-x402");
});
