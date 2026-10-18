// Every message the kit prints, English only.
const M = {
  needNode: "Node.js 22 or newer is required. You have {v}.",
  askName: "Project name (type anything you like): ",
  nameRequired: "No terminal to ask in. Pass the project name with --name.",
  badName: "That name has no letters or digits. Try another.",
  exists: "A folder named {dir} already exists. Choose another name.",
  badOption: "{option} must be one of: {allowed}.",
  badSeed: "--seed must be a whole number, 0 or more.",
  created: "Created {dir}",
  variant: "Variant: {v}",
  next: "Next steps:\n  cd {dir}\n  npm install\n  npm run check",
  testnet: "This is practice on a test network. No real money is involved.",
};

export function msg(key, vars = {}) {
  return M[key].replace(/\{(\w+)\}/g, (_m, k) => String(vars[k] ?? ""));
}
