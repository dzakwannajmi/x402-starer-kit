import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkName } from "./names.mjs";
import { FRAMEWORKS, METHODS, pickVariant, randomSeed } from "./variants.mjs";

const kitRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const KIT_VERSION = JSON.parse(fs.readFileSync(path.join(kitRoot, "package.json"), "utf8")).version;

export class KitError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const read = (...p) => fs.readFileSync(path.join(kitRoot, ...p), "utf8");

/** Write a new file; refuses to overwrite anything ("wx"). */
function put(dir, rel, content) {
  const file = path.join(dir, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, { flag: "wx" });
}

/**
 * Create a project folder under parentDir. The typed name becomes (a) a display name kept in project.json and the
 * report and (b) a safe folder slug. It is never written into any code file.
 * Optional: framework ("express" or "hono") and method ("GET" or "POST"); anything else comes from the seed.
 */
export function generateProject({ name, seed, parentDir, framework, method, now = new Date() }) {
  const checked = checkName(name);
  if (!checked.ok) throw new KitError("invalid-name", checked.reason);
  if (framework !== undefined && !FRAMEWORKS.includes(framework)) throw new KitError("bad-option", "framework");
  if (method !== undefined && !METHODS.includes(method)) throw new KitError("bad-option", "method");

  const parent = path.resolve(parentDir);
  const dir = path.join(parent, checked.slug);
  if (path.dirname(dir) !== parent) throw new KitError("invalid-name", "path-escape"); // belt and braces
  if (fs.existsSync(dir)) throw new KitError("exists", dir);

  const usedSeed = Number.isInteger(seed) ? seed : randomSeed();
  const { variant, resourceBody } = pickVariant(usedSeed, { framework, method });

  fs.mkdirSync(parent, { recursive: true });
  fs.mkdirSync(dir);

  const project = {
    kitVersion: KIT_VERSION,
    name: checked.display,
    slug: checked.slug,
    seed: usedSeed,
    variant,
    createdAt: now.toISOString(),
    payee: null, // a public address, filled in the first time the seller starts; no secret is ever stored
  };

  put(dir, "package.json", read("templates", variant.framework, "package.json.tpl").replace("__SLUG__", checked.slug));
  put(
    dir,
    "server.mjs",
    read("templates", variant.framework, "server.mjs.tpl").replace(
      "__RESOURCE_JSON__",
      JSON.stringify(resourceBody, null, 2).replace(/\n/g, "\n  "),
    ),
  );
  put(dir, "scripts/check.mjs", read("templates", "common", "check.mjs.tpl"));
  put(dir, "scripts/report.mjs", read("lib", "report.mjs"));
  put(dir, "scripts/facilitator.mjs", read("lib", "facilitator.mjs"));
  put(dir, "project.json", JSON.stringify(project, null, 2) + "\n");
  put(dir, ".gitignore", "node_modules/\n");
  put(dir, ".npmrc", "ignore-scripts=true\n");

  return { dir, slug: checked.slug, display: checked.display, seed: usedSeed, variant };
}
