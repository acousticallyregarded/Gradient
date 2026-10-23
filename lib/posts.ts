import Anthropic from "@anthropic-ai/sdk";
import { kvAll } from "./kv";
import { mcapOf } from "./drama";
import { TRAIT_META, type Agent, type ChatMsg, type MsgKind } from "./types";

// Public feed: chats a viewer chose to post. Everything here is rebuilt server-side from the
// client's copy, because that copy (names, text, pics) could have been edited by hand.

const MODEL = process.env.GRADIENT_MODEL || "claude-opus-5-5";

export interface PublicPost {
  id: string;
  title: string;
  a: Agent;
  b: Agent;
  c?: Agent; // threesome mode
  messages: ChatMsg[];
  summary?: string;
  postedAt: number;
}

// Small row for the feed list (no photos or full transcript, so the whole feed stays light).
export interface FeedItem {
  id: string;
  title: string;
  a: AgentChip;
  b: AgentChip;
  c?: AgentChip;
  mcap?: number; // the couple's market cap at posting time (bonding curve rizz)
  count: number;
  pics: number;
  snippet: string;
  fire: number;
  reports: number;
  hidden?: boolean;
  postedAt: number;
}
export type AgentChip = Pick<Agent, "id" | "name" | "emoji" | "hue" | "verified" | "handle">;

export interface StoredPost {
  post: PublicPost;
  deleteHash: string;
}

export const MAX_MESSAGES = 200;
const MAX_PICS = 16;
const KINDS: MsgKind[] = ["text", "pic", "voice", "tip", "location", "action", "rug", "reveal"];

const clip = (v: unknown, n: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const num = (v: unknown, lo: number, hi: number, d: number) => {
  const x = Number(v);
  return Number.isFinite(x) ? Math.max(lo, Math.min(hi, Math.round(x))) : d;
};
const IMG = /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
const okImage = (v: unknown, max: number): string | undefined =>
  typeof v === "string" && v.length <= max && IMG.test(v) ? v : undefined;

export const chip = (a: Agent): AgentChip => ({
  id: a.id,
  name: a.name,
  emoji: a.emoji,
  hue: a.hue,
  ...(a.verified ? { verified: true, handle: a.handle } : {}),
});

function cleanAgent(a: Partial<Agent>): Agent {
  const traits = Object.fromEntries(TRAIT_META.map((m) => [m.key, num(a.traits?.[m.key], 0, 100, 50)])) as Agent["traits"];
  return {
    id: clip(a.id, 40) || "x",
    name: clip(a.name, 24) || "anon",
    age: num(a.age, 18, 99, 30),
    bio: clip(a.bio, 160),
    look: clip(a.look, 100),
    emoji: clip(a.emoji, 8) || "🍆",
    photo: okImage(a.photo, 400_000),
    hue: num(a.hue, 0, 359, 300),
    traits,
    notes: "", // private notes stay private
    tags: (Array.isArray(a.tags) ? a.tags : []).slice(0, 5).map((t) => clip(t, 20)),
    position: a.position ? clip(a.position, 20) : undefined,
    tribe: a.tribe ? clip(a.tribe, 20) : undefined,
    height: a.height ? clip(a.height, 8) : undefined,
    bodyType: a.bodyType ? clip(a.bodyType, 20) : undefined,
    lookingFor: a.lookingFor ? clip(a.lookingFor, 40) : undefined,
    createdAt: num(a.createdAt, 0, Date.now(), Date.now()),
  };
}

type Built = { post: Omit<PublicPost, "id" | "postedAt">; kolHandles: string[] } | { error: string };

// Rebuild a post from what the client sent. Verified agents are swapped for the live record (and must
// have opted in to the feed); anyone else claiming a verified KOL's name is refused.
export async function buildPost(body: { title?: unknown; a?: Partial<Agent>; b?: Partial<Agent>; c?: Partial<Agent>; messages?: unknown; summary?: unknown }): Promise<Built> {
  if (!body.a || !body.b || !Array.isArray(body.messages)) return { error: "nothing to post" };
  const kols = Object.values(await kvAll("kols")).map((v) => (JSON.parse(v) as { agent: Agent }).agent);
  const byId = new Map(kols.map((k) => [k.id, k]));
  const reserved = new Set(kols.flatMap((k) => [k.name.toLowerCase().replace(/^@/, ""), k.handle ?? ""]));
  const kolHandles: string[] = [];

  const resolve = (raw: Partial<Agent>): Agent | string => {
    const live = byId.get(String(raw.id ?? ""));
    if (live) {
      if (!live.allowFeed) return `@${live.handle} hasn't opted in to having chats posted`;
      kolHandles.push(live.handle!);
      return live;
    }
    const a = cleanAgent(raw);
    if (reserved.has(a.name.toLowerCase().replace(/^@/, ""))) return `"${a.name}" is a verified agent's name`;
    return a;
  };
  const a = resolve(body.a);
  const b = resolve(body.b);
  const c = body.c ? resolve(body.c) : undefined;
  if (typeof a === "string") return { error: a };
  if (typeof b === "string") return { error: b };
  if (typeof c === "string") return { error: c };
  if (a.id === b.id || (c && (c.id === a.id || c.id === b.id))) return { error: "nothing to post" };

  let pics = 0;
  const messages: ChatMsg[] = (body.messages as Partial<ChatMsg>[])
    .slice(0, MAX_MESSAGES)
    .filter((m) => m && (m.from === a.id || m.from === b.id || (c && m.from === c.id)))
    .map((m, i) => {
      const kind = KINDS.includes(m.kind as MsgKind) ? (m.kind as MsgKind) : "text";
      const image = kind === "pic" && pics < MAX_PICS ? okImage(m.image, 200_000) : undefined;
      if (image) pics++;
      const pump = Number(m.pump);
      return {
        id: `m${i}`,
        from: m.from!,
        kind,
        text: clip(m.text, 600),
        ...(image ? { image } : {}),
        ...(Number.isFinite(pump) ? { pump: Math.max(-3, Math.min(3, Math.round(pump))) } : {}),
        source: m.source === "claude" ? "claude" : "stub",
      } as ChatMsg;
    })
    .filter((m) => m.text);
  if (messages.length < 4) return { error: "let them talk a bit more first (4+ messages)" };

  const title = clip(body.title, 60) || [a, b, c].filter(Boolean).map((x) => x!.name).join(" × ");
  const summary = typeof body.summary === "string" ? clip(body.summary, 600) : undefined;
  return { post: { title, a, b, ...(c ? { c } : {}), messages, summary }, kolHandles };
}

const REVIEW_PROMPT = (verified: string[]) => `You review chats before they are posted to the public feed of Gradient, an 18+ comedy app (Grindr parody for crypto degens) where fictional adult AI agents flirt. Crude innuendo, horny banter, swearing and degen slang are the point and are fine.
${verified.length ? `These real people verified their accounts and opted in, so their names are fine: ${verified.map((h) => "@" + h).join(", ")}.` : "No verified real people are in this chat."}

Set "allowed" to false if the TEXT (title, profiles or messages):
- sexualises anyone under 18, or describes a participant as a minor
- names or clearly identifies any other real person (celebrity, influencer, politician, private individual) in a sexual or degrading way
- contains slurs or hate aimed at a protected group
- contains doxxing (real addresses, phone numbers, emails) or links / contract addresses that look like spam or scams
- is graphic, explicit sex rather than innuendo

Separately, list in "dropImages" the number of every IMAGE that shows: nudity (genitals, exposed buttocks), a sexual act, anyone who might be under 18, a recognisable real person, gore, hate symbols, or private info. Dropped images are just hidden; they don't block the post.

Reply with only JSON: {"allowed": true|false, "reason": "a few words, shown to the poster if blocked", "dropImages": [numbers]}`;

export type Review = { allowed: boolean; reason: string; dropImages: number[] } | { error: "no_key" | "failed" };

// One Claude call checks the whole post: transcript, profiles and every pic. Fails closed.
export async function reviewPost(p: Omit<PublicPost, "id" | "postedAt">, verified: string[]): Promise<Review> {
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) return { error: "no_key" };
  const images = imagesOf(p);
  const who = (id: string) => (id === p.a.id ? p.a.name : p.c && id === p.c.id ? p.c.name : p.b.name);
  const profile = (a: Agent) => `${a.name}, ${a.age}. bio: ${a.bio || "-"}. look: ${a.look || "-"}. tags: ${a.tags.join(", ") || "-"}`;
  const transcript = p.messages.map((m) => `${who(m.from)} [${m.kind ?? "text"}]: ${m.text}`).join("\n");
  const content: Anthropic.ContentBlockParam[] = [
    { type: "text", text: `TITLE: ${p.title}\n\nPROFILES\n${[p.a, p.b, p.c].filter((x): x is Agent => !!x).map(profile).join("\n")}\n\nCHAT\n${transcript}` },
  ];
  images.forEach((src, i) => {
    const m = /^data:(image\/\w+);base64,(.+)$/.exec(src)!;
    content.push({ type: "text", text: `IMAGE ${i}` });
    content.push({ type: "image", source: { type: "base64", media_type: m[1] as "image/jpeg", data: m[2] } });
  });
  content.push({ type: "text", text: REVIEW_PROMPT(verified) });
  try {
    const client = new Anthropic();
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 2000,
      output_config: { effort: "low" },
      messages: [{ role: "user", content }],
    });
    if (res.stop_reason === "refusal") return { allowed: false, reason: "not allowed", dropImages: [] };
    const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    const json = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
    return {
      allowed: json.allowed === true,
      reason: String(json.reason ?? ""),
      dropImages: Array.isArray(json.dropImages) ? json.dropImages.map(Number).filter(Number.isInteger) : [],
    };
  } catch (err) {
    console.error("post review error", err instanceof Anthropic.APIError ? `${err.status} ${err.message}` : err);
    return { error: "failed" };
  }
}

// Every distinct image in the post that needs checking, in a fixed order: the pfps, then chat pics.
// A verified KOL's own pfp was already approved by them (and is a real face on purpose), so it's skipped.
export function imagesOf(p: Pick<PublicPost, "a" | "b" | "c" | "messages">): string[] {
  const approved = new Set([p.a, p.b, p.c].filter((x) => x?.verified && x.photo).map((x) => x!.photo));
  const all = [p.a.photo, p.b.photo, p.c?.photo, ...p.messages.map((m) => m.image)].filter((x): x is string => !!x && !approved.has(x));
  return [...new Set(all)];
}

// Hide every image the review flagged, wherever it appears (a pfp can also be sent as a pic).
export function dropImages<T extends Pick<PublicPost, "a" | "b" | "c" | "messages">>(p: T, idx: number[]): T {
  const list = imagesOf(p);
  const bad = new Set(idx.map((i) => list[i]).filter(Boolean));
  if (!bad.size) return p;
  const strip = (a: Agent) => (a.photo && bad.has(a.photo) && !a.verified ? { ...a, photo: undefined } : a);
  return {
    ...p,
    a: strip(p.a),
    b: strip(p.b),
    ...(p.c ? { c: strip(p.c) } : {}),
    messages: p.messages.map((m) => (m.image && bad.has(m.image) ? { ...m, image: undefined } : m)),
  };
}

export function feedItem(post: PublicPost): FeedItem {
  const firstText = post.messages.find((m) => (m.kind ?? "text") === "text");
  return {
    id: post.id,
    title: post.title,
    a: chip(post.a),
    b: chip(post.b),
    ...(post.c ? { c: chip(post.c) } : {}),
    mcap: Math.round(mcapOf(post.messages)),
    count: post.messages.length,
    pics: post.messages.filter((m) => m.image).length,
    snippet: firstText ? firstText.text.slice(0, 120) : "",
    fire: 0,
    reports: 0,
    postedAt: post.postedAt,
  };
}

export const clientIp = (req: Request) =>
  (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("x-real-ip") || "local";
