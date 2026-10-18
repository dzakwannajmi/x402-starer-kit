#!/usr/bin/env node
// x402-starter-kit: generate a small x402 seller on localhost (testnet only), then check it with Wasit.
//   node kit.mjs new [--name "My project"] [--seed 123] [--framework express|hono] [--method GET|POST] [--dir <folder>]
//                    [--exercise [--defect <id>]]
import path from "node:path";
import readline from "node:readline/promises";
import { parseArgs } from "node:util";
import { generateProject, KitError } from "./lib/generate.mjs";
import { msg } from "./lib/messages.mjs";
import { checkName } from "./lib/names.mjs";
import { DEFECT_IDS } from "./lib/defects.mjs";
import { FRAMEWORKS, METHODS } from "./lib/variants.mjs";

const major = Number(process.versions.node.split(".")[0]);
if (major < 22) {
  console.error(msg("needNode", { v: process.versions.node }));
  process.exit(1);
}

const USAGE = `x402-starter-kit

  node kit.mjs new [--name "My project"] [--seed <number>] [--framework express|hono]
                   [--method GET|POST] [--dir <parent folder>] [--exercise [--defect <id>]]

  Creates a small x402 seller of your own on localhost (testnet only).
  Anything you leave out (framework, method, path, theme, price) is picked from the seed.

  --exercise   break and fix: one defect is written into server.mjs on purpose; find it from the report.
               The defect is picked from the seed unless you name one with --defect.
`;

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    name: { type: "string" },
    seed: { type: "string" },
    framework: { type: "string" },
    method: { type: "string" },
    dir: { type: "string" },
    exercise: { type: "boolean" },
    defect: { type: "string" },
    help: { type: "boolean", short: "h" },
  },
});

if (values.help || positionals[0] !== "new") {
  console.log(USAGE);
  process.exit(values.help ? 0 : 1);
}

const parentDir = path.resolve(values.dir ?? process.cwd());
let seed;
if (values.seed !== undefined) {
  seed = Number(values.seed);
  if (!Number.isInteger(seed) || seed < 0) {
    console.error(msg("badSeed"));
    process.exit(1);
  }
}

const framework = values.framework?.toLowerCase();
const method = values.method?.toUpperCase();
if (framework !== undefined && !FRAMEWORKS.includes(framework)) {
  console.error(msg("badOption", { option: "--framework", allowed: FRAMEWORKS.join(", ") }));
  process.exit(1);
}
if (method !== undefined && !METHODS.includes(method)) {
  console.error(msg("badOption", { option: "--method", allowed: METHODS.join(", ") }));
  process.exit(1);
}

const defect = values.defect?.toLowerCase();
if (defect !== undefined && !DEFECT_IDS.includes(defect)) {
  console.error(msg("badOption", { option: "--defect", allowed: DEFECT_IDS.join(", ") }));
  process.exit(1);
}

async function askName(rl) {
  for (;;) {
    const answer = await rl.question(msg("askName"));
    if (!checkName(answer).ok) {
      console.log(msg("badName"));
      continue;
    }
    return answer;
  }
}

async function main() {
  let rl = null;
  try {
    let name = values.name;
    if (name === undefined) {
      if (!process.stdin.isTTY) {
        console.error(msg("nameRequired"));
        process.exit(1);
      }
      rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      name = await askName(rl);
    }
    for (;;) {
      try {
        const out = generateProject({ name, seed, parentDir, framework, method, exercise: values.exercise, defect });
        const v = out.variant;
        console.log("\n" + msg("created", { dir: out.dir }));
        console.log(
          msg("variant", { v: `${v.framework}, ${v.method} ${v.path}, ${v.resource}, price ${v.price}, ${v.network}, seed ${out.seed}` }),
        );
        console.log("\n" + msg("next", { dir: out.slug }));
        if (out.exercise) console.log("\n" + msg("exerciseNext")); // never names the defect
        console.log("\n" + msg("testnet"));
        return;
      } catch (e) {
        if (e instanceof KitError && e.code === "exists" && rl) {
          console.log(msg("exists", { dir: e.message }));
          name = await askName(rl);
          continue;
        }
        throw e;
      }
    }
  } finally {
    rl?.close();
  }
}

main().catch((e) => {
  if (e instanceof KitError) {
    console.error(e.code === "exists" ? msg("exists", { dir: e.message }) : msg("badName"));
  } else {
    console.error(e?.message || e);
  }
  process.exit(1);
});
