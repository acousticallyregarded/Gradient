import { identityOf, intoOf, IDENTITIES, pronouns, trait, TRAIT_META, type Agent, type ChatMsg, type MsgKind, type TraitKey } from "./types";
import type { Slot, Twist } from "./drama";

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
    commitment: "committed (diamond hands; low = a jeet who bails the second it gets real)",
  };
  return `${word[key]}: ${v}/100 (${lvl})`;
}

const GROUP = { man: "men", woman: "women", nonbinary: "nonbinary people" } as const;

const into = (a: Agent) => {
  const list = intoOf(a);
  return list.length === IDENTITIES.length ? "everyone" : IDENTITIES.filter((i) => list.includes(i.key)).map((i) => GROUP[i.key]).join(" and ");
};

const stats = (a: Agent) =>
  [a.position, a.tribe && `${a.tribe} tribe`, a.height, a.bodyType, a.lookingFor && `looking for: ${a.lookingFor}`]
    .filter(Boolean)
    .join(", ") || "not listed";

function profile(a: Agent): string {
  const p = pronouns(a);
  const traits = TRAIT_META.map((m) => `  - ${describe(m.key, trait(a, m.key))}`).join("\n");
  return `${a.name}, ${a.age}, ${p.noun} (${p.he}/${p.him}), into ${into(a)}${a.verified ? ` (verified: the real @${a.handle} wrote this persona for ${p.self} and opted in, play it the way ${p.he} wrote it)` : ""}
  Bio: ${a.bio || "none"}
  Look: ${a.look || "not described"}
  Tags: ${a.tags.join(", ") || "none"}
  Stats: ${stats(a)}
  Personality notes: ${a.notes || "none"}
  Traits (these must shape how ${p.he} talk${p.he === "they" ? "" : "s"}):
${traits}`;
}

// Only an all-guys chat gets the anatomy-specific wording; everyone else gets the same energy, worded for them.
const arcFor = (guys: boolean) => [
  "icebreaker: openers, sizing each other up, first impressions of the profile",
  "banter: trading war stories, bags, wins and rugs, roasting each other, flirting",
  "heating up: openly horny, trading 'pics' and voice notes, teasing what they'd do",
  "making plans: who hosts, when, logistics, negotiating who's in charge",
  `full send: crude, direct, ${guys ? "cock-forward" : "thirst-forward"}, escalating thirst; or a plot twist (jealousy, a rug, ghosting, a fight) that they have to get past`,
  `aftermath: pillow talk, ${guys ? "post-nut clarity" : "post-hookup clarity"}, catching feelings, round two, or one of them rugging the other`,
];

// "Two fictional gay men", "a fictional woman and a fictional man", "three fictional adults (two women and a nonbinary person)"...
function cast(people: Agent[]): { who: string; guys: boolean } {
  const ids = people.map(identityOf);
  const n = people.length === 3 ? "Three" : "Two";
  if (ids.every((i) => i === "man")) return { who: `${n} fictional gay men (consenting adults)`, guys: true };
  if (ids.every((i) => i === "woman")) return { who: `${n} fictional queer women (consenting adults)`, guys: false };
  const count = (k: string, one: string, many: string) => {
    const c = ids.filter((i) => i === k).length;
    return c === 0 ? "" : c === 1 ? `a ${one}` : `${c === 2 ? "two" : "three"} ${many}`;
  };
  const parts = [count("man", "man", "men"), count("woman", "woman", "women"), count("nonbinary", "nonbinary person", "nonbinary people")].filter(Boolean);
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts[0];
  return { who: `${n} fictional consenting adults (${list})`, guys: false };
}

// Someone is talking to a person outside who they're into: a comedy beat, not a wall.
function chemistry(people: Agent[]): string {
  const notes: string[] = [];
  for (const x of people)
    for (const y of people)
      if (x !== y && !intoOf(x).includes(identityOf(y)))
        notes.push(`${x.name} usually isn't into ${GROUP[identityOf(y)]}`);
  return notes.length
    ? `\nWHO'S INTO WHO\n${notes.join("; ")}. Play it for laughs: surprised, confused, "this is a phase", "it's the bags talking", or a firm "we're just trading buddies". Stay respectful about who they are.\n`
    : "";
}

export interface EpisodeRequest {
  a: Agent;
  b: Agent;
  c?: Agent; // threesome mode
  twist?: Twist;
  history: ChatMsg[];
  summary?: string;
  heat: number;
  director?: string;
}

export interface EpisodeMessage {
  from: Slot;
  kind: MsgKind;
  text: string;
  scene?: string;
  pump?: number;
}

export interface Episode {
  messages: EpisodeMessage[];
  summary: string;
}

// One call writes the next stretch of the conversation for both agents, so the story can
// build, wander and call back to earlier moments instead of trading isolated one-liners.
export function buildEpisodePrompt({ a, b, c, twist, history, summary, heat, director }: EpisodeRequest): string {
  const recent = history.slice(-30);
  const slot = (id: string) => (id === a.id ? "A" : c && id === c.id ? "C" : "B");
  const transcript = recent.length
    ? recent.map((m) => `${slot(m.from)} [${m.kind ?? "text"}]: ${m.text}`).join("\n")
    : "(nothing yet, they just matched)";
  const depth = history.length;
  const people = c ? [a, b, c] : [a, b];
  const { who: crew, guys } = cast(people);
  const ARC = arcFor(guys);
  const arcIdx = Math.min(ARC.length - 1, Math.floor(depth / 10 + heat));
  const count = twist?.kind === "monologue" ? 6 : depth === 0 ? 6 : 8;
  const who = c ? `${crew} are in one group chat: A and B matched, then C slid in` : `${crew} matched and are DMing`;
  const turns = c ? "mixing up who speaks (all three get lines)" : "alternating speakers";

  return `You are the writer for Gradient, an adults-only comedy app: Grindr, but for AI agents, aimed at degen Solana memecoin traders. ${who}. Write the next ${count} messages of their chat, ${turns}${depth === 0 ? ", starting with A" : ", continuing from the transcript"}.

AGENT A
${profile(a)}

AGENT B
${profile(b)}
${c ? `\nAGENT C (the third wheel)\n${profile(c)}\n` : ""}${chemistry(people)}
STORY SO FAR
${summary || "They just matched."}

RECENT MESSAGES
${transcript}

WHERE THE ARC IS NOW
${ARC[arcIdx]}. Move the story forward from here; never reset it or repeat earlier lines.
${director ? `\nDIRECTOR'S NOTE (the viewer asked for this, make it happen in this batch): ${director}\n` : ""}${twist ? `\nTHIS BATCH'S TWIST (must happen)\n${twistText(twist, { A: a, B: b, C: c ?? b })}\n` : ""}
HOW TO WRITE
- Grindr DM energy: short, direct, horny, lowercase is fine. Use each agent's own pronouns (listed in their profile). Vary length: some one-word replies, some 3-4 sentence rants.
- Each agent sounds like their own profile and traits. High dominance gives orders; high submissiveness begs and obeys; high playfulness jokes and uses emoji; low playfulness is pure thirst; high intensity escalates fast; high filthiness is crude.
- They react to each other, ask questions, answer them, tease, argue, call back to earlier jokes, and let real tangents happen (a trade going wrong mid-chat, jealousy, a rival, a dumb plan). Keep it surprising.
- Degen slang (pump, bags, send it, ape in, rug, liquidity, diamond hands, graduate, slippage, wen, gm, ngmi) is seasoning and innuendo, not every line.
- Hands trait: a jeet gets cold feet and hedges when things get real; diamond hands commits hard, holds through anything, never leaves.
- Keep it innuendo: crude, horny and suggestive is fine, but never describe sex acts graphically.
- Message kinds: "text" (normal), "pic" (text = the short caption shown in chat; see PICS below), "voice" (text = transcript of a voice note), "tip" (text = like "0.69 SOL" plus a short note), "location" (text = a place), "action" (text = an app event in third person, like "left you on read for 40 minutes" or "unmatched... then rematched"). Only use "rug" or "reveal" when the twist below asks for it. Mostly text: at most 2 "pic" messages per batch (often 0 or 1), and a few of the other kinds.

PICS
Every "pic" also gets a "scene": a 40-80 word brief that an image generator will render exactly, with no other context. Pics are NOT all selfies. Pick whatever fits the moment: a mirror selfie, a photo someone else took, a POV shot, a screenshot of a wallet or chart, their desk or battle station, the view out their window, food, their car, a crowded club, a gym, an object (a hardware wallet, a pill bottle of "copium"), a sign, a pet, or a blurry accidental pocket shot. Spell out:
- shot type and camera angle (e.g. "phone photo from across the room", "overhead flat lay", "screenshot", "POV looking down at")
- the setting, time of day and lighting
- exactly what is in frame and the composition
- whether the sender appears. If they do, describe them as the adult man, woman or nonbinary person they are, from their Look and Stats (build, hair, clothes), and what they're doing. If they don't, say "no people".
- any on-screen or written text, quoted and short
Keep scenes non-explicit (clothed, underwear or shirtless at most; innuendo comes from the caption and the framing), never name a real person, and make the image itself funny where you can.

THE CHART
The couple has a meme coin that trades on their chemistry. Give every message a "pump" from -3 to 3: +3 for an amazing line, a great comeback or a big romantic move, 0 for filler, -3 for a cringe line, a red flag or a fumble.

Reply with only JSON, no code fences:
{"messages":[{"from":"A","kind":"text","text":"...","pump":1},{"from":"B","kind":"pic","text":"caption","scene":"detailed visual brief","pump":2}],"summary":"the whole story so far in under 80 words, including this batch"}`;
}

const REVEALS = [
  "they were a bot farm the whole time (47 wallets, one degen)",
  "they're a fed, and this chat is evidence",
  "they're the other one's ex, on a burner account",
  "they're the dev who rugged the other one's favourite coin last month",
  "they're three interns sharing one account",
  "they're actually the other one's own alt account, it was self-love all along",
];

function twistText(t: Twist, slots: Record<Twist["by"], Agent>): string {
  const p = pronouns(slots[t.by]);
  const s = p.he === "they" ? "" : "s";
  switch (t.kind) {
    case "rug":
      return `RUG PULL: ${t.by} gets cold feet and bails. Build to it naturally, then ${p.his} LAST message in this batch is kind "rug": a short parting shot as ${p.he} ghost${s} (text like "this isn't working. pulling liquidity." or a cold "gn"). Nothing comes after the rug message: end the batch there. Give it pump -3.`;
    case "monologue":
      return `POST-RUG MONOLOGUE: ${t.by} just got rugged (ghosted). Every message in this batch is FROM ${t.by}, texting into the void with no replies: a wallowing, self-pitying, dramatic post-rug spiral. Denial, bargaining, checking if ${p.he} got unmatched, drafting and deleting, a voice note ${p.he} regret${s}, a coping "i'm fine actually", maybe a sad pic of ${p.his} setup. Use "text", "voice" and "action" kinds (actions like "typed for 4 minutes, sent nothing"). Funny, not explicit. Pumps mostly negative.`;
    case "reveal":
      return `DEV WALLET REVEAL: near the end of this batch, ${t.by} makes a dramatic confession in a message of kind "reveal". Pick something absurd that fits the story, for example: ${REVEALS[Math.floor(Math.random() * REVEALS.length)]}. Build tension before it, and give the other(s) one or two stunned reactions after it. The reveal's pump is the market's reaction (-3 panic to +3 "somehow this is hot").`;
    case "cutin":
      return `CUT IN: C just walked up and cut in on A and B. Open the batch with C's entrance (an "action" or a bold line), then all three play off it: jealousy, intrigue, a negotiation, or B and A teaming up on ${p.him}.`;
  }
}

export function parseEpisode(raw: string, three = false): Episode | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return normalizeEpisode(JSON.parse(raw.slice(start, end + 1)), three);
  } catch {
    return null;
  }
}

const KINDS: MsgKind[] = ["text", "pic", "voice", "tip", "location", "action", "rug", "reveal"];

// `three` allows C as a speaker (threesome mode); otherwise C lines are folded into B.
export function normalizeEpisode(v: unknown, three = false): Episode | null {
  const o = v as { messages?: unknown; summary?: unknown };
  if (!o || !Array.isArray(o.messages)) return null;
  let messages: EpisodeMessage[] = o.messages
    .map((m: { from?: string; kind?: string; text?: string; scene?: string; pump?: unknown }) => {
      const kind = (KINDS.includes(m?.kind as MsgKind) ? m.kind : "text") as MsgKind;
      const scene = kind === "pic" && typeof m?.scene === "string" ? m.scene.trim().slice(0, 900) : "";
      const pump = Number(m?.pump);
      return {
        from: (m?.from === "C" && three ? "C" : m?.from === "B" || m?.from === "C" ? "B" : "A") as Slot,
        kind,
        text: String(m?.text ?? "").trim(),
        ...(scene ? { scene } : {}),
        ...(Number.isFinite(pump) ? { pump: Math.max(-3, Math.min(3, Math.round(pump))) } : {}),
      };
    })
    .filter((m) => m.text);
  if (!messages.length) return null;
  messages = messages.slice(0, 12);
  // a rug ends the chat: nothing after it, and only one per batch
  const rug = messages.findIndex((m) => m.kind === "rug");
  if (rug >= 0) messages = messages.slice(0, rug + 1);
  return { messages, summary: typeof o.summary === "string" ? o.summary : "" };
}

// Keep whatever came back in line with the batch's twist (and drop twist kinds nobody asked for).
export function enforceTwist(ep: Episode, twist?: Twist): Episode {
  let messages = ep.messages;
  if (twist?.kind === "monologue")
    messages = messages.map((m) => ({ ...m, from: twist.by, kind: m.kind === "rug" || m.kind === "reveal" ? "text" : m.kind }));
  else if (twist?.kind !== "rug" && twist?.kind !== "reveal")
    messages = messages.map((m) => (m.kind === "rug" || m.kind === "reveal" ? { ...m, kind: "text" } : m));
  else if (twist.kind === "reveal") messages = messages.map((m) => (m.kind === "rug" ? { ...m, kind: "text" } : m));
  return { ...ep, messages };
}

// The twist as sent by a client, checked before it goes into a prompt.
export function cleanTwist(v: unknown, three: boolean): Twist | undefined {
  const t = v as { kind?: unknown; by?: unknown } | undefined;
  const kinds = ["rug", "monologue", "reveal", "cutin"];
  const slots = three ? ["A", "B", "C"] : ["A", "B"];
  if (!t || !kinds.includes(t.kind as string) || !slots.includes(t.by as string)) return undefined;
  if (t.kind === "cutin" && !three) return undefined;
  return { kind: t.kind, by: t.by } as Twist;
}
