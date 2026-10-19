import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFECT_IDS, DEFECTS, defectById, exerciseAnswer, exerciseHook } from "./defects.mjs";
import { checkName } from "./names.mjs";
import { FRAMEWORKS, METHODS, mulberry32, pickVariant, randomSeed } from "./variants.mjs";

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

/** The seller's source. `defect` (an entry of DEFECTS, or null) adds the exercise's response clean-up block. */
export function renderServer({ framework, resourceBody, defect = null }) {
  return read("templates", framework, "server.mjs.tpl")
    .replace("__RESOURCE_JSON__", () => JSON.stringify(resourceBody, null, 2).replace(/\n/g, "\n  "))
    .replace("__EXERCISE_HOOK__", () => (defect ? exerciseHook(framework, defect) : ""));
}

/** Which defect an exercise gets when none is named: drawn from the seed, so a seed keeps its meaning. */
function defectFromSeed(seed) {
  const rand = mulberry32((seed ^ 0x9e3779b9) >>> 0);
  return DEFECTS[Math.floor(rand() * DEFECTS.length)];
}

/**
 * Create a project folder under parentDir. The typed name becomes (a) a display name kept in project.json and the
 * report and (b) a safe folder slug. It is never written into any code file.
 * Optional: framework ("express" or "hono"), method ("GET" or "POST"), exercise (true) and defect (an id from the
 * catalogue; naming one implies exercise). Anything else comes from the seed.
 */
export function generateProject({ name, seed, parentDir, framework, method, exercise = false, defect: defectId, now = new Date() }) {
  const checked = checkName(name);
  if (!checked.ok) throw new KitError("invalid-name", checked.reason);
  if (framework !== undefined && !FRAMEWORKS.includes(framework)) throw new KitError("bad-option", "framework");
  if (method !== undefined && !METHODS.includes(method)) throw new KitError("bad-option", "method");
  if (defectId !== undefined && !DEFECT_IDS.includes(defectId)) throw new KitError("bad-option", "defect");

  const parent = path.resolve(parentDir);
  const dir = path.join(parent, checked.slug);
  if (path.dirname(dir) !== parent) throw new KitError("invalid-name", "path-escape"); // belt and braces
  if (fs.existsSync(dir)) throw new KitError("exists", dir);

  const usedSeed = Number.isInteger(seed) ? seed : randomSeed();
  const { variant, resourceBody } = pickVariant(usedSeed, { framework, method });
  const isExercise = exercise || defectId !== undefined;
  const defect = isExercise ? (defectId ? defectById(defectId) : defectFromSeed(usedSeed)) : null;

  fs.mkdirSync(parent, { recursive: true });
  fs.mkdirSync(dir);

  const project = {
    kitVersion: KIT_VERSION,
    name: checked.display,
    slug: checked.slug,
    seed: usedSeed,
    variant, // variant.defect stays null: the answer is only in .exercise.json
    createdAt: now.toISOString(),
    payee: null, // a public address, filled in the first time the seller starts; no secret is ever stored
    ...(defect ? { exercise: { expectedFailing: defect.expectedFailing } } : {}),
  };

  const pkg = JSON.parse(read("templates", variant.framework, "package.json.tpl").replace("__SLUG__", checked.slug));
  pkg.scripts["check:full"] = "node scripts/check.mjs --full";
  pkg.scripts.feedback = "node scripts/feedback.mjs";
  if (defect) pkg.scripts.exercise = "node scripts/exercise.mjs";

  put(dir, "package.json", JSON.stringify(pkg, null, 2) + "\n");
  put(dir, "server.mjs", renderServer({ framework: variant.framework, resourceBody, defect }));
  put(dir, "scripts/check.mjs", read("templates", "common", "check.mjs.tpl"));
  put(dir, "scripts/report.mjs", read("lib", "report.mjs"));
  put(dir, "scripts/facilitator.mjs", read("lib", "facilitator.mjs"));
  put(dir, "scripts/full.mjs", read("lib", "full.mjs"));
  put(dir, "scripts/feedback-lib.mjs", read("lib", "feedback.mjs"));
  put(dir, "scripts/nextsteps.mjs", read("lib", "nextsteps.mjs"));
  put(dir, "scripts/feedback.mjs", read("templates", "common", "feedback.mjs.tpl"));
  put(dir, "project.json", JSON.stringify(project, null, 2) + "\n");
  put(dir, ".gitignore", "node_modules/\n.env\n.env.*\n");
  put(dir, ".npmrc", "ignore-scripts=true\n");
  if (defect) {
    put(dir, "scripts/exercise.mjs", read("templates", "common", "exercise.mjs.tpl"));
    put(dir, ".exercise.json", JSON.stringify(exerciseAnswer(defect), null, 2) + "\n");
  }

  return { dir, slug: checked.slug, display: checked.display, seed: usedSeed, variant, exercise: Boolean(defect), resourceBody };
}
