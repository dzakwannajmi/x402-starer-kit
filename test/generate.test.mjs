import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { generateProject, KitError } from "../lib/generate.mjs";
import { FRAMEWORKS, METHODS, NETWORKS, PATHS, PRICES, THEMES, pickVariant } from "../lib/variants.mjs";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "x402kit-"));
const allFiles = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? allFiles(path.join(dir, e.name)) : [path.join(dir, e.name)]));
const gen = (opts = {}) => generateProject({ name: "my project", seed: 7, parentDir: tmp(), ...opts });
const text = (out, rel) => fs.readFileSync(path.join(out.dir, rel), "utf8");

test("generates the expected files with exact pinned versions, for every framework", () => {
  for (const framework of FRAMEWORKS) {
    const out = gen({ framework });
    assert.equal(out.variant.framework, framework);
    for (const f of ["package.json", "server.mjs", "project.json", "scripts/check.mjs", "scripts/report.mjs", "scripts/facilitator.mjs", ".gitignore", ".npmrc"]) {
      assert.ok(fs.existsSync(path.join(out.dir, f)), `${framework}: ${f}`);
    }
    const pkg = JSON.parse(text(out, "package.json"));
    for (const [name, range] of Object.entries(pkg.dependencies)) {
      assert.match(range, /^\d+\.\d+\.\d+$/, `${framework}: ${name} must be an exact version, got ${range}`);
    }
    assert.ok(pkg.dependencies[`@x402/${framework}`], `${framework}: the official middleware package is a dependency`);
    // Wasit is deliberately NOT a dependency of the project: its tree needs @stellar/stellar-sdk 15 while the x402
    // libraries use 16, and installing both in one tree prints peer-dependency conflicts. It runs through npx.
    assert.equal(pkg.devDependencies, undefined);
    assert.ok(!JSON.stringify(pkg).includes("@wasit-dev"));
    const check = text(out, "scripts/check.mjs");
    assert.match(check, /const WASIT_VERSION = "0\.7\.0";/);
    assert.ok(check.includes("@wasit-dev/cli@${WASIT_VERSION}"));
    assert.equal(text(out, ".npmrc").trim(), "ignore-scripts=true");
  }
});

test("no secret key and no unmasked 64-hex value anywhere in a generated project", () => {
  for (const framework of FRAMEWORKS) {
    const out = gen({ framework, name: "secrets check" });
    for (const f of allFiles(out.dir)) {
      const t = fs.readFileSync(f, "utf8");
      assert.ok(!/\bS[A-Z2-7]{55}\b/.test(t), `${f} has something that looks like a secret key`);
      assert.ok(!/\b[0-9a-fA-F]{64}\b/.test(t), `${f} has a 64-hex value`);
    }
    assert.equal(JSON.parse(text(out, "project.json")).payee, null);
  }
});

test("the typed name is data: it never reaches a code file, and traversal stays inside the parent folder", () => {
  for (const framework of FRAMEWORKS) {
    const parent = tmp();
    const evil = '"; process.exit(1); //../../evil';
    const out = generateProject({ name: evil, seed: 3, parentDir: parent, framework });
    assert.equal(path.dirname(out.dir), parent);
    for (const f of ["server.mjs", "scripts/check.mjs", "scripts/facilitator.mjs", "package.json"]) {
      assert.ok(!text(out, f).includes("process.exit(1); //"), `${framework}: ${f}`);
    }
    assert.equal(JSON.parse(text(out, "project.json")).name, evil); // kept as typed, as data
    assert.deepEqual(fs.readdirSync(parent), [out.slug]); // nothing was written next to it
  }
});

test("never overwrites, rejects unusable names, and rejects unknown options", () => {
  const parent = tmp();
  generateProject({ name: "same", seed: 1, parentDir: parent });
  assert.throws(() => generateProject({ name: "same", seed: 2, parentDir: parent }), (e) => e instanceof KitError && e.code === "exists");
  assert.throws(() => generateProject({ name: "   ", parentDir: parent }), (e) => e instanceof KitError && e.code === "invalid-name");
  assert.throws(() => generateProject({ name: "x", parentDir: parent, framework: "koa" }), (e) => e instanceof KitError && e.code === "bad-option");
  assert.throws(() => generateProject({ name: "y", parentDir: parent, method: "DELETE" }), (e) => e instanceof KitError && e.code === "bad-option");
});

test("variants: same seed, same variant; every axis stays inside its allowed set; all values are reachable", () => {
  assert.deepEqual(pickVariant(99), pickVariant(99));
  const seen = { framework: new Set(), method: new Set(), path: new Set(), resource: new Set(), price: new Set() };
  for (let seed = 0; seed < 400; seed++) {
    const { variant } = pickVariant(seed);
    assert.ok(FRAMEWORKS.includes(variant.framework));
    assert.ok(METHODS.includes(variant.method));
    assert.ok(PATHS.includes(variant.path));
    assert.match(variant.path, /^\/[a-z0-9/_-]+$/);
    assert.ok(THEMES.some((t) => t.id === variant.resource));
    assert.ok(PRICES.includes(variant.price));
    assert.equal(variant.defect, null);
    for (const k of Object.keys(seen)) seen[k].add(variant[k]);
  }
  assert.equal(seen.framework.size, FRAMEWORKS.length);
  assert.equal(seen.method.size, METHODS.length);
  assert.equal(seen.path.size, PATHS.length);
  assert.equal(seen.resource.size, THEMES.length);
  assert.equal(seen.price.size, PRICES.length);
});

test("overriding the framework or the method changes only that axis (the seed keeps its meaning)", () => {
  for (let seed = 0; seed < 50; seed++) {
    const base = pickVariant(seed).variant;
    const over = pickVariant(seed, { framework: "hono", method: "POST" }).variant;
    assert.equal(over.framework, "hono");
    assert.equal(over.method, "POST");
    assert.deepEqual({ ...over, framework: base.framework, method: base.method }, base);
  }
  assert.equal(gen({ framework: "hono", method: "POST" }).variant.method, "POST");
});

test("testnet only: no other network exists in the kit, the variants or any generated file", () => {
  assert.deepEqual(NETWORKS, ["stellar:testnet"]);
  for (let seed = 0; seed < 50; seed++) assert.equal(pickVariant(seed).variant.network, "stellar:testnet");
  for (const framework of FRAMEWORKS) {
    const out = gen({ framework, name: "net check" });
    for (const f of ["server.mjs", "scripts/check.mjs", "scripts/facilitator.mjs", "package.json"]) {
      assert.ok(!/pubnet|mainnet|stellar:public/i.test(text(out, f)), `${framework}: ${f} mentions a non-testnet network`);
    }
  }
});

test("the seller binds 127.0.0.1 only; the check runs Wasit read-only and passes --method for POST", () => {
  const express = gen({ framework: "express", name: "bind express" });
  assert.match(text(express, "server.mjs"), /app\.listen\(PORT, "127\.0\.0\.1"/);
  const hono = gen({ framework: "hono", name: "bind hono" });
  assert.match(text(hono, "server.mjs"), /hostname: "127\.0\.0\.1"/);
  for (const out of [express, hono]) {
    assert.ok(!/0\.0\.0\.0/.test(text(out, "server.mjs")));
    const check = text(out, "scripts/check.mjs");
    assert.ok(check.includes('"--read-only"'));
    assert.ok(check.includes('"--json"'));
    assert.ok(check.includes('["--method", "POST"]'));
  }
});

test("the copied helper modules are standalone", () => {
  const out = gen({ name: "standalone" });
  assert.ok(!/^import\s/m.test(text(out, "scripts/report.mjs")), "report.mjs imports nothing");
  const imports = text(out, "scripts/facilitator.mjs").match(/^import .*$/gm) ?? [];
  assert.deepEqual(imports, ['import http from "node:http";']);
});

test("every generated file is valid JavaScript, for every framework and method", () => {
  for (const framework of FRAMEWORKS) {
    for (const method of METHODS) {
      const out = gen({ framework, method, name: `syntax ${framework} ${method}` });
      for (const f of ["server.mjs", "scripts/check.mjs", "scripts/report.mjs", "scripts/facilitator.mjs", "scripts/full.mjs", "scripts/nextsteps.mjs"]) {
        const r = spawnSync(process.execPath, ["--check", path.join(out.dir, f)], { encoding: "utf8" });
        assert.equal(r.status, 0, `${framework} ${method} ${f}: ${r.stderr}`);
      }
    }
  }
});
