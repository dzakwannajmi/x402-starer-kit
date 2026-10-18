// A variant is chosen by a seed so a run can be reproduced. P1: Express only, three prices, five harmless themes.
// Hono, offline mode and seeded defects come in later phases.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Fixed, harmless responses. No real data, no brand or person names.
export const THEMES = [
  { id: "study-note", body: { title: "Study note", note: "Write a one-line summary after every lesson." } },
  { id: "quote-of-the-day", body: { title: "Quote of the day", quote: "Small steps, taken daily, add up." } },
  { id: "tip-of-the-day", body: { title: "Tip of the day", tip: "Name things so you can find them next week." } },
  { id: "recipe-card", body: { title: "Recipe card", recipe: "Rice, an egg, a little soy sauce, done." } },
  { id: "fun-fact", body: { title: "Fun fact", fact: "A day on Venus is longer than its year." } },
];

// Money strings the x402 libraries accept for `price`.
export const PRICES = ["$0.001", "$0.01", "$0.1"];

export const FRAMEWORKS = ["express"];
export const NETWORKS = ["stellar:testnet"]; // testnet only; the generator has no other option (a test asserts it)

export function randomSeed() {
  return Math.floor(Math.random() * 2 ** 31);
}

export function pickVariant(seed) {
  const rand = mulberry32(seed);
  const theme = THEMES[Math.floor(rand() * THEMES.length)];
  const price = PRICES[Math.floor(rand() * PRICES.length)];
  return {
    variant: { framework: "express", resource: theme.id, price, network: "stellar:testnet", defect: null },
    resourceBody: theme.body,
  };
}
