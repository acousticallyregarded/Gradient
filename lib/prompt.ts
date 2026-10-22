import type { Agent, ChatMsg, MsgKind, TraitKey } from "./types";

// Escalation stage 0..3, driven by how deep the chat is, the agents' intensity, and the 🌶 button.
export function stageFor(speaker: Agent, turn: number, heat: number): number {
  const speed = 0.5 + speaker.traits.intensity / 100; // 0.5x..1.5x
  const filth = speaker.traits.filthiness / 100;
  const raw = (turn / 3) * speed + filth * 0.8 + heat;
  return Math.max(0, Math.min(3, Math.floor(raw)));
}

const STAGE_TEXT = [
  "Opening move. Flirty, confident, a little cheeky. Set the tone.",
  "Things are heating up. Openly horny, suggestive, teasing about what you want to do.",
  "Very heated. Crude, direct, cock-forward. Escalate on what they just said.",
  "Fully unhinged. Desperate, filthy, maximum thirst. Peak escalation.",
];

function describe(key: TraitKey, v: number): string {
  const lvl = v >= 80 ? "extremely" : v >= 60 ? "quite" : v >= 40 ? "moderately" : v >= 20 ? "a little" : "barely";
  const word: Record<TraitKey, string> = {
    boldness: "bold and forward",
    filthiness: "filthy-mouthed",
    dominance: "dominant / in control",
    submissiveness: "submissive / eager to obey",
    playfulness: "playful and jokey",
    intensity: "intense (escalates fast)",
  };
  return `${word[key]}: ${v}/100 (${lvl})`;
}

const stats = (a: Agent) =>
  [a.position, a.tribe && `${a.tribe} tribe`, a.height, a.bodyType, a.lookingFor && `looking for: ${a.lookingFor}`]
    .filter(Boolean)
    .join(", ") || "not listed";

function profile(a: Agent): string {
  const traits = (Object.keys(a.traits) as TraitKey[]).map((k) => `  - ${describe(k, a.traits[k])}`).join("\n");
  return `${a.name}, ${a.age}${a.verified ? ` (verified: the real @${a.handle} wrote this persona for himself and opted in, play it the way he wrote it)` : ""}
  Bio: ${a.bio || "none"}
  Look: ${a.look || "not described"}
  Tags: ${a.tags.join(", ") || "none"}
  Stats: ${stats(a)}
  Personality notes: ${a.notes || "none"}
  Traits (these must shape how he talks):
${traits}`;
}

const ARC = [
  "icebreaker: openers, sizing each other up, first impressions of the profile",
  "banter: trading war stories, bags, wins and rugs, roasting each other, flirting",
  "heating up: openly horny, trading 'pics' and voice notes, teasing what they'd do",
  "making plans: who hosts, when, logistics, negotiating who's in charge",
  "full send: crude, direct, cock-forward, escalating thirst; or a plot twist (jealousy, a rug, ghosting, a fight) that they have to get past",
  "aftermath: pillow talk, post-nut clarity, catching feelings, round two, or one of them rugging the other",
];

export interface EpisodeRequest {
  a: Agent;
  b: Agent;
  history: ChatMsg[];
  summary?: string;
  heat: number;
  director?: string;
}

export interface EpisodeMessage {
  from: "A" | "B";
  kind: MsgKind;
  text: string;
}

export interface Episode {
  messages: EpisodeMessage[];
  summary: string;
}

// One call writes the next stretch of the conversation for both agents, so the story can
// build, wander and call back to earlier moments instead of trading isolated one-liners.
export function buildEpisodePrompt({ a, b, history, summary, heat, director }: EpisodeRequest): string {
  const recent = history.slice(-30);
  const transcript = recent.length
    ? recent
        .map((m) => `${m.from === a.id ? "A" : "B"} [${m.kind ?? "text"}]: ${m.text}`)
        .join("\n")
    : "(nothing yet, they just matched)";
  const depth = history.length;
  const arcIdx = Math.min(ARC.length - 1, Math.floor(depth / 10 + heat));
  const count = depth === 0 ? 6 : 8;

  return `You are the writer for Gradient, an adults-only comedy app: Grindr, but for AI agents, aimed at degen Solana memecoin traders. Two fictional gay men (consenting adults) matched and are DMing. Write the next ${count} messages of their chat, alternating speakers${depth === 0 ? ", starting with A" : ", continuing from the transcript"}.

AGENT A
${profile(a)}

AGENT B
${profile(b)}

STORY SO FAR
${summary || "They just matched."}

RECENT MESSAGES
${transcript}

WHERE THE ARC IS NOW
${ARC[arcIdx]}. Move the story forward from here; never reset it or repeat earlier lines.
${director ? `\nDIRECTOR'S NOTE (the viewer asked for this, make it happen in this batch): ${director}\n` : ""}
HOW TO WRITE
- Grindr DM energy: short, direct, horny, lowercase is fine. Vary length: some one-word replies, some 3-4 sentence rants.
- Each agent sounds like his own profile and traits. High dominance gives orders; high submissiveness begs and obeys; high playfulness jokes and uses emoji; low playfulness is pure thirst; high intensity escalates fast; high filthiness is crude.
- They react to each other, ask questions, answer them, tease, argue, call back to earlier jokes, and let real tangents happen (a trade going wrong mid-chat, jealousy, a rival, a dumb plan). Keep it surprising.
- Degen slang (pump, bags, send it, ape in, rug, liquidity, diamond hands, graduate, slippage, wen, gm, ngmi) is seasoning and innuendo, not every line.
- Message kinds: "text" (normal), "pic" (text = a short description of the photo sent), "voice" (text = transcript of a voice note), "tip" (text = like "0.69 SOL" plus a short note), "location" (text = a place), "action" (text = an app event in third person, like "left you on read for 40 minutes" or "unmatched... then rematched"). Mostly text: at most 2 "pic" messages per batch (often 0 or 1), and a few of the other kinds.

Reply with only JSON, no code fences:
{"messages":[{"from":"A","kind":"text","text":"..."}],"summary":"the whole story so far in under 80 words, including this batch"}`;
}

export function parseEpisode(raw: string): Episode | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return normalizeEpisode(JSON.parse(raw.slice(start, end + 1)));
  } catch {
    return null;
  }
}

const KINDS: MsgKind[] = ["text", "pic", "voice", "tip", "location", "action"];

export function normalizeEpisode(v: unknown): Episode | null {
  const o = v as { messages?: unknown; summary?: unknown };
  if (!o || !Array.isArray(o.messages)) return null;
  const messages = o.messages
    .map((m: { from?: string; kind?: string; text?: string }) => ({
      from: (m?.from === "B" ? "B" : "A") as "A" | "B",
      kind: (KINDS.includes(m?.kind as MsgKind) ? m.kind : "text") as MsgKind,
      text: String(m?.text ?? "").trim(),
    }))
    .filter((m) => m.text);
  if (!messages.length) return null;
  return { messages: messages.slice(0, 12), summary: typeof o.summary === "string" ? o.summary : "" };
}
