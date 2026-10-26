import { STARTERS } from "./starters";
import { identityOf, type Agent, type Identity } from "./types";

// Every picture in the UI (icons, avatars, illustrations) is generated once by /api/art from a prompt
// listed here, then cached in KV and on the CDN for good. Nothing in the interface is an emoji.
// Changing a prompt changes its hash, so the new version gets generated and the old cache is skipped.

export type ArtKind = "icon" | "portrait" | "scene" | "shot";

interface ArtSpec {
  kind: ArtKind;
  subject: string;
  identity?: Identity; // portraits and shots only; missing = man
}

// Who's in the photo. The man's wording is the original one, so his cached portraits keep their hash.
const NOUN: Record<Identity, string> = { man: "man", woman: "woman", nonbinary: "androgynous nonbinary person" };
const subjectIs = (id: Identity) => ({ man: "He is", woman: "She is", nonbinary: "They are" })[id];

// One shared look for the icons so the whole set reads as a family.
const ICON_STYLE =
  "A single glossy 3D icon, soft clay-like render with smooth rounded shapes, rich gradient of warm coral, hot pink and violet with soft white highlights, gentle studio lighting, centered with generous padding, isolated on a fully transparent background. No text, no letters, no numbers, no border, no drop shadow on the ground.";

const PORTRAIT_STYLE = (id: Identity) =>
  `Candid dating-app profile photo of a fictional adult ${NOUN[id]} (not any real or famous person). Vertical portrait framing from the chest up, natural flattering light, shallow depth of field, real-camera photorealism, warm color grade, looking relaxed and confident. Fully clothed. No text, logos, watermarks or captions.`;

const SHOT_STYLE = (id: Identity) =>
  `Casual phone photo from a fictional adult ${NOUN[id]}'s dating profile (not any real or famous person). Real-camera photorealism, natural light, vertical framing, fully clothed. No text, logos, watermarks or captions.`;

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
// Each one has an identity, so the picker can show the matching set first and the portrait prompt says who it is.
export const AVATARS: { key: string; label: string; look: string; identity?: Identity }[] = [
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
  { key: "💅", label: "baddie", look: "glam woman in her mid 20s, long box braids, gold hoops, satin slip dress, rooftop bar at dusk", identity: "woman" },
  { key: "🎧", label: "e-girl", look: "e-girl around 22 with pastel pink hair, winged eyeliner, oversized band tee, gamer headset, LED-lit bedroom", identity: "woman" },
  { key: "🥂", label: "socialite", look: "polished woman in her 30s, sleek blowout, white blazer, champagne flute, yacht deck", identity: "woman" },
  { key: "🏋️", label: "gym girl", look: "athletic woman in a matching sports set, high ponytail, gym mirror behind her", identity: "woman" },
  { key: "🌻", label: "cottage", look: "freckled redhead in a sundress and cardigan, holding iced coffee, farmers market", identity: "woman" },
  { key: "🖤", label: "goth", look: "goth woman with a black bob, dark lipstick, choker, leather jacket, moody bar", identity: "woman" },
  { key: "👩‍💻", label: "quant", look: "sharp woman in her early 30s with glasses, black turtleneck, three monitors of charts behind her", identity: "woman" },
  { key: "🔥", label: "tomboy", look: "tomboy woman with a short pixie cut, backwards cap, oversized flannel, skate park", identity: "woman" },
  { key: "🌈", label: "androgynous", look: "androgynous person with a bleached buzzcut, silver eyeliner, mesh top under a blazer, neon club", identity: "nonbinary" },
  { key: "🦋", label: "soft enby", look: "soft androgynous person with a curly mullet, pastel knit sweater, rings on every finger, cozy cafe", identity: "nonbinary" },
  { key: "🛹", label: "skater", look: "androgynous skater with a split-dye shag haircut, baggy cargo pants, tattooed forearms, golden hour", identity: "nonbinary" },
  { key: "🌙", label: "witchy", look: "androgynous person with long black hair, crystal necklaces, velvet jacket, candlelit apartment", identity: "nonbinary" },
];

const starterLook = (a: Agent) =>
  [`about ${a.age}`, a.bodyType && `${a.bodyType.toLowerCase()} build`, a.height, a.look].filter(Boolean).join(", ");

// Extra shots for the house agents' profiles, so they have a camera roll like a real dating profile.
// Each one restates their look so the photos read as the same person.
const EXTRA_SHOTS = [
  "Candid photo at the gym between sets, sweaty and grinning, wearing a fitted tee",
  "Night-out photo at a neon-lit bar, drink in hand, laughing with friends blurred behind him",
  "Daytime photo at a sunny brunch table, sunglasses pushed up, phone showing a green price chart",
];
const shotFor = (shot: string, id: Identity) => (id === "man" ? shot : shot.replace(/\bhim\b/, id === "woman" ? "her" : "them"));

const SPECS: Record<string, ArtSpec> = {
  ...Object.fromEntries(Object.entries(ICONS).map(([k, v]) => [`icon-${k}`, { kind: "icon" as const, subject: v }])),
  ...Object.fromEntries(Object.entries(SCENES).map(([k, v]) => [`scene-${k}`, { kind: "scene" as const, subject: v }])),
  ...Object.fromEntries(
    AVATARS.map((a) => [`avatar-${a.label.replace(/\s+/g, "-")}`, { kind: "portrait" as const, subject: a.look, identity: a.identity }]),
  ),
  ...Object.fromEntries(STARTERS.map((a) => [`agent-${a.id}`, { kind: "portrait" as const, subject: starterLook(a), identity: a.identity }])),
  ...Object.fromEntries(
    STARTERS.flatMap((a) =>
      EXTRA_SHOTS.map((shot, i) => [
        `agent-${a.id}-${i + 2}`,
        { kind: "shot" as const, subject: `${shotFor(shot, identityOf(a))}. ${subjectIs(identityOf(a))} ${starterLook(a)}.`, identity: a.identity },
      ]),
    ),
  ),
};

export const ART_NAMES = Object.keys(SPECS);

export function artPrompt(name: string): string | null {
  const s = SPECS[name];
  if (!s) return null;
  if (s.kind === "icon") return `${ICON_STYLE} The icon: ${s.subject}.`;
  if (s.kind === "scene") return `${SCENE_STYLE} The scene: ${s.subject}.`;
  const id = s.identity ?? "man";
  if (s.kind === "shot") return `${SHOT_STYLE(id)} ${s.subject}`;
  return `${PORTRAIT_STYLE(id)} ${subjectIs(id)} ${s.subject}.`;
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

// Every picture on an agent's profile, main one first. Only house agents have extra shots.
export function agentGallery(a: Pick<Agent, "id" | "emoji">): string[] {
  const main = avatarArt(a);
  if (!main) return [];
  const extra = EXTRA_SHOTS.map((_, i) => `agent-${a.id}-${i + 2}`).filter((n) => SPECS[n]);
  return [main, ...extra];
}
