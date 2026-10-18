import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { generateProject, KitError } from "../lib/generate.mjs";
import { NETWORKS, pickVariant, PRICES, THEMES } from "../lib/variants.mjs";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "x402kit-"));
const allFiles = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? allFiles(path.join(dir, e.name)) : [path.join(dir, e.name)]));

test("generates the expected files with pinned versions only", () => {
  const parent = tmp();
  const out = generateProject({ name: "My First x402", seed: 7, parentDir: parent });
  assert.equal(path.dirname(out.dir), parent);
  for (const f of ["package.json", "server.mjs", "project.json", "scripts/check.mjs", "scripts/report.mjs", ".gitignore", ".npmrc"]) {
    assert.ok(fs.existsSync(path.join(out.dir, f)), f);
  }
  const pkg = JSON.parse(fs.readFileSync(path.join(out.dir, "package.json"), "utf8"));
  for (const [name, range] of Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })) {
    assert.match(range, /^\d+\.\d+\.\d+$/, `${name} must be an exact version, got ${range}`);
  }
  // Wasit is deliberately NOT a dependency of the project: its tree needs @stellar/stellar-sdk 15 while the x402
  // libraries use 16, and installing both in one tree prints peer-dependency conflicts. It runs through npx.
  assert.equal(pkg.devDependencies, undefined);
  assert.ok(!JSON.stringify(pkg).includes("@wasit-dev"));
  const check = fs.readFileSync(path.join(out.dir, "scripts/check.mjs"), "utf8");
  assert.match(check, /const WASIT_VERSION = "0\.7\.0";/);
  assert.ok(check.includes("@wasit-dev/cli@${WASIT_VERSION}"));
  assert.equal(fs.readFileSync(path.join(out.dir, ".npmrc"), "utf8").trim(), "ignore-scripts=true");
});

test("no secret key and no unmasked 64-hex value anywhere in a generated project", () => {
  const out = generateProject({ name: "secrets check", seed: 1, parentDir: tmp() });
  for (const f of allFiles(out.dir)) {
    const text = fs.readFileSync(f, "utf8");
    assert.ok(!/\bS[A-Z2-7]{55}\b/.test(text), `${f} has something that looks like a secret key`);
    assert.ok(!/\b[0-9a-fA-F]{64}\b/.test(text), `${f} has a 64-hex value`);
  }
  assert.equal(JSON.parse(fs.readFileSync(path.join(out.dir, "project.json"), "utf8")).payee, null);
});

test("the typed name is data: it never reaches a code file, and traversal stays inside the parent folder", () => {
  const parent = tmp();
  const evil = '"; process.exit(1); //../../evil';
  const out = generateProject({ name: evil, seed: 3, parentDir: parent });
  assert.equal(path.dirname(out.dir), parent);
  for (const f of ["server.mjs", "scripts/check.mjs", "package.json"]) {
    assert.ok(!fs.readFileSync(path.join(out.dir, f), "utf8").includes("process.exit(1); //"), f);
  }
  const project = JSON.parse(fs.readFileSync(path.join(out.dir, "project.json"), "utf8"));
  assert.equal(project.name, evil); // kept as typed, as data
  assert.deepEqual(fs.readdirSync(parent), [out.slug]); // nothing was written next to it
});

test("never overwrites, and rejects unusable names", () => {
  const parent = tmp();
  generateProject({ name: "same", seed: 1, parentDir: parent });
  assert.throws(() => generateProject({ name: "same", seed: 2, parentDir: parent }), (e) => e instanceof KitError && e.code === "exists");
  assert.throws(() => generateProject({ name: "   ", parentDir: parent }), (e) => e instanceof KitError && e.code === "invalid-name");
});

test("same seed, same variant; every variant is in the allowed sets", () => {
  assert.deepEqual(pickVariant(99), pickVariant(99));
  for (let seed = 0; seed < 200; seed++) {
    const { variant } = pickVariant(seed);
    assert.ok(THEMES.some((t) => t.id === variant.resource));
    assert.ok(PRICES.includes(variant.price));
    assert.equal(variant.framework, "express");
    assert.equal(variant.defect, null);
  }
});

test("testnet only: no other network exists in the kit, the variants or the generated code", () => {
  assert.deepEqual(NETWORKS, ["stellar:testnet"]);
  for (let seed = 0; seed < 50; seed++) assert.equal(pickVariant(seed).variant.network, "stellar:testnet");
  const out = generateProject({ name: "net check", seed: 5, parentDir: tmp() });
  for (const f of ["server.mjs", "scripts/check.mjs", "package.json"]) {
    const text = fs.readFileSync(path.join(out.dir, f), "utf8");
    assert.ok(!/pubnet|mainnet|stellar:public/i.test(text), `${f} mentions a non-testnet network`);
  }
});

test("the seller binds 127.0.0.1 only and the check runs Wasit read-only", () => {
  const out = generateProject({ name: "bind check", seed: 5, parentDir: tmp() });
  const server = fs.readFileSync(path.join(out.dir, "server.mjs"), "utf8");
  assert.match(server, /app\.listen\(PORT, "127\.0\.0\.1"/);
  assert.ok(!/0\.0\.0\.0/.test(server));
  const check = fs.readFileSync(path.join(out.dir, "scripts/check.mjs"), "utf8");
  assert.ok(check.includes('"--read-only"'));
  assert.ok(check.includes('"--json"'));
});

test("scripts/report.mjs is standalone (it imports nothing)", () => {
  const out = generateProject({ name: "standalone", seed: 5, parentDir: tmp() });
  assert.ok(!/^import\s/m.test(fs.readFileSync(path.join(out.dir, "scripts/report.mjs"), "utf8")));
});

test("the generated server file is valid JavaScript", async () => {
  const out = generateProject({ name: "syntax", seed: 11, parentDir: tmp() });
  const { spawnSync } = await import("node:child_process");
  for (const f of ["server.mjs", "scripts/check.mjs", "scripts/report.mjs"]) {
    const r = spawnSync(process.execPath, ["--check", path.join(out.dir, f)], { encoding: "utf8" });
    assert.equal(r.status, 0, `${f}: ${r.stderr}`);
  }
});
