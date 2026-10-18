// A variant is chosen by a seed so a run can be reproduced. Participants may override the framework and the HTTP
// method; everything else comes from the seed. Seeded defects (exercise mode) come in a later phase.

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
  { id: "word-of-the-day", body: { title: "Word of the day", word: "serendipity", meaning: "a happy accident" } },
  { id: "workout-plan", body: { title: "Workout plan", plan: "Ten minutes of stretching, then a short walk." } },
  { id: "reading-list", body: { title: "Reading list", list: ["A short story", "A long poem", "One good essay"] } },
];

// Money strings the x402 libraries accept for `price`.
export const PRICES = ["$0.001", "$0.005", "$0.01", "$0.05", "$0.1"];

export const FRAMEWORKS = ["express", "hono"];
export const METHODS = ["GET", "POST"];
// Fixed list: a path is never taken from user input. Every entry matches /^\/[a-z0-9/_-]+$/.
export const PATHS = ["/paid", "/premium", "/api/data", "/api/insight", "/v1/answer", "/content/secret"];
export const NETWORKS = ["stellar:testnet"]; // testnet only; the generator has no other option (a test asserts it)

export function randomSeed() {
  return Math.floor(Math.random() * 2 ** 31);
}

const pick = (list, rand) => list[Math.floor(rand() * list.length)];

/** overrides: { framework?, method? } (already validated by the caller). */
export function pickVariant(seed, overrides = {}) {
  const rand = mulberry32(seed);
  // Always draw in the same order so a seed keeps its meaning even when an axis is overridden.
  const framework = pick(FRAMEWORKS, rand);
  const method = pick(METHODS, rand);
  const path = pick(PATHS, rand);
  const theme = pick(THEMES, rand);
  const price = pick(PRICES, rand);
  return {
    variant: {
      framework: overrides.framework ?? framework,
      method: overrides.method ?? method,
      path,
      resource: theme.id,
      price,
      network: "stellar:testnet",
      defect: null,
    },
    resourceBody: theme.body,
  };
}
