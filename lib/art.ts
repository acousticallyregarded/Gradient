import { STARTERS } from "./starters";
import type { Agent } from "./types";

// Every picture in the UI (icons, avatars, illustrations) is generated once by /api/art from a prompt
// listed here, then cached in KV and on the CDN for good. Nothing in the interface is an emoji.
// Changing a prompt changes its hash, so the new version gets generated and the old cache is skipped.

export type ArtKind = "icon" | "portrait" | "scene";

interface ArtSpec {
  kind: ArtKind;
  subject: string;
}

// One shared look for the icons so the whole set reads as a family.
const ICON_STYLE =
  "A single glossy 3D icon, soft clay-like render with smooth rounded shapes, rich gradient of warm coral, hot pink and violet with soft white highlights, gentle studio lighting, centered with generous padding, isolated on a fully transparent background. No text, no letters, no numbers, no border, no drop shadow on the ground.";

const PORTRAIT_STYLE =
  "Candid dating-app profile photo of a fictional adult man (not any real or famous person). Vertical portrait framing from the chest up, natural flattering light, shallow depth of field, real-camera photorealism, warm color grade, looking relaxed and confident. Fully clothed. No text, logos, watermarks or captions.";

const SCENE_STYLE =
  "Glossy 3D illustration, soft clay-like render, warm coral, hot pink and violet palette with soft white highlights, dreamy lighting, centered composition, isolated on a fully transparent background. No text, no letters, no people.";

export const ICONS = {
  grid: "a neat two-by-two grid of rounded photo tiles",
  bar: "a sparkling disco ball",
  deploy: "a small rocket lifting off with a puff of cloud",
  mine: "a profile card with a smiling avatar silhouette",
  inbox: "a speech bubble with a small heart inside",
  feed: "a globe with little orbiting hearts",
  flame: "a single bright flame",
  chat: "two overlapping speech bubbles",
  direct: "a film clapperboard",
  heat: "a red chili pepper",
  rug: "a mousetrap baited with a gold coin",
  reveal: "a magnifying glass over a leather wallet",
  siren: "a red police siren light, glowing",
  third: "three hearts linked together in a row",
  kick: "a waving hand saying goodbye",
  trending: "a rising candlestick chart with an upward arrow",
  gossip: "a folded tabloid newspaper",
  camera: "a retro instant camera",
  tip: "a small stack of cash with tiny wings",
  pin: "a map location pin",
  tomb: "a cartoon tombstone with a crack",
  graduated: "a graduation cap with a tassel",
  dice: "a pair of dice mid-roll",
  cocktail: "a martini glass with an olive",
  eyes: "a pair of big cartoon eyes peeking sideways",
  wallet: "a sleek wallet with a violet coin peeking out",
  flag: "a small waving red flag on a pole",
  lock: "a padlock shaped like a heart",
  verified: "a rounded badge with a check mark",
  sparkle: "a cluster of three sparkles",
  voice: "a vintage microphone",
} as const;

export type IconName = keyof typeof ICONS;

export const SCENES = {
  hero: "two glossy chat bubbles, one coral and one violet, overlapping to form a heart, with small sparkles around them",
  match: "two hearts colliding with a burst of confetti and sparkles",
  empty: "an empty cocktail glass with a bent straw and a single sparkle",
} as const;

export type SceneName = keyof typeof SCENES;

// Avatar choices for agents people make. The agent's `emoji` field still stores the old emoji as the key,
// so agents saved before this (and share links) keep working; the UI only ever shows the portrait.
export const AVATARS: { key: string; label: string; look: string }[] = [
  { key: "🐻", label: "bear", look: "big bearded guy in his 40s, broad chest, flannel shirt, warm smile, cabin porch at golden hour" },
  { key: "🧃", label: "twink", look: "boyish slim guy around 22, pastel windbreaker, bleached hair, holding a juice box, city street" },
  { key: "💎", label: "jock", look: "muscular guy in a fitted tank top, small diamond stud earrings, gym locker room" },
  { key: "🤖", label: "dev", look: "nerdy coder with glasses lit by blue monitor glow, hoodie, dark room with LEDs" },
  { key: "🫠", label: "sunburnt", look: "sunburnt guy at a beach bar, unbuttoned linen shirt, laughing, golden hour" },
  { key: "😤", label: "brat", look: "pouting bratty guy with a septum ring and painted nails, oversized vintage tee, neon-lit club" },
  { key: "🐸", label: "frog", look: "smirking guy in a green frog-print hoodie, messy hair, skate park" },
  { key: "🦍", label: "ape", look: "huge hairy muscle guy in a tight black tee, gold chain, nightclub" },
  { key: "🐂", label: "bull", look: "confident finance guy in an open-collar navy suit, gym build, trading floor screens behind him" },
  { key: "🧶", label: "soft", look: "soft-spoken guy in a chunky knit cardigan holding a latte, cozy cafe" },
  { key: "🪵", label: "lumberjack", look: "rugged bearded lumberjack in a red plaid shirt, axe on his shoulder, pine forest" },
  { key: "🍑", label: "gym rat", look: "athletic guy in short running shorts and a cropped hoodie leaving the gym, golden hour" },
  { key: "🍆", label: "cheeky", look: "cheeky grinning guy in a purple velour tracksuit, rooftop party" },
  { key: "🚀", label: "astro", look: "guy in a vintage orange astronaut bomber jacket, rooftop at night, city lights" },
  { key: "👅", label: "party", look: "playful guy sticking his tongue out, festival glitter on his cheeks, mesh tank top, festival lights" },
  { key: "🐍", label: "slick", look: "slick guy in a snakeskin print shirt, slicked-back hair, sunglasses, casino bar" },
];

const starterLook = (a: Agent) =>
  [`about ${a.age}`, a.bodyType && `${a.bodyType.toLowerCase()} build`, a.height, a.look].filter(Boolean).join(", ");

const SPECS: Record<string, ArtSpec> = {
  ...Object.fromEntries(Object.entries(ICONS).map(([k, v]) => [`icon-${k}`, { kind: "icon" as const, subject: v }])),
  ...Object.fromEntries(Object.entries(SCENES).map(([k, v]) => [`scene-${k}`, { kind: "scene" as const, subject: v }])),
  ...Object.fromEntries(AVATARS.map((a) => [`avatar-${a.label.replace(/\s+/g, "-")}`, { kind: "portrait" as const, subject: a.look }])),
  ...Object.fromEntries(STARTERS.map((a) => [`agent-${a.id}`, { kind: "portrait" as const, subject: starterLook(a) }])),
};

export const ART_NAMES = Object.keys(SPECS);

export function artPrompt(name: string): string | null {
  const s = SPECS[name];
  if (!s) return null;
  if (s.kind === "icon") return `${ICON_STYLE} The icon: ${s.subject}.`;
  if (s.kind === "scene") return `${SCENE_STYLE} The scene: ${s.subject}.`;
  return `${PORTRAIT_STYLE} He is ${s.subject}.`;
}

export const artKind = (name: string): ArtKind | null => SPECS[name]?.kind ?? null;

// FNV-1a, so the browser and the server agree on a version tag without any crypto.
function hash(s: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export const artVersion = (name: string) => hash(artPrompt(name) ?? name);

export const artUrl = (name: string) => `/api/art/${name}?v=${artVersion(name)}`;

// Which generated portrait stands in for an agent that has no uploaded photo.
export function avatarArt(a: Pick<Agent, "id" | "emoji">): string | null {
  if (SPECS[`agent-${a.id}`]) return `agent-${a.id}`;
  const preset = AVATARS.find((x) => x.key === a.emoji || x.label === a.emoji);
  return preset ? `avatar-${preset.label.replace(/\s+/g, "-")}` : null;
}
