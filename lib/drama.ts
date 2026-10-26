import { trait, type Agent, type ChatMsg, type Match } from "./types";
import { uid } from "./storage";
import type { Episode } from "./prompt";

// The degen drama layer on top of a chat: the couple's bonding curve, rug pull breakups,
// jeets vs diamond hands, the dev wallet reveal and threesome mode.

export type Slot = "A" | "B" | "C";

// A plot beat the next batch must hit. Picked here (in the browser) so the UI, the prompt and the
// offline stub all agree on it.
export type Twist =
  | { kind: "rug"; by: Slot } // `by` ghosts mid-chat: liquidity removed
  | { kind: "monologue"; by: Slot } // `by` just got rugged and wallows, texting into the void
  | { kind: "reveal"; by: Slot } // `by` confesses they were a bot farm, a fed, the other's ex...
  | { kind: "cutin"; by: Slot }; // `by` (always C) just cut in on the date

export const slotOf = (m: Pick<Match, "a" | "b" | "third">, id: string): Slot =>
  id === m.a.id ? "A" : m.third && id === m.third.id ? "C" : "B";

export const agentOf = (m: Pick<Match, "a" | "b" | "third">, id: string): Agent =>
  id === m.a.id ? m.a : m.third && id === m.third.id ? m.third : m.b;

export const agentAt = (m: Pick<Match, "a" | "b" | "third">, s: Slot): Agent =>
  s === "A" ? m.a : s === "C" && m.third ? m.third : m.b;

// How spicy the chat is right now, same scale as the prompt's arc (0 icebreaker .. 5 aftermath).
const arcLevel = (m: Match) => Math.floor(m.messages.length / 10 + m.heat);

// The next batch's twist, if any. Forced ones come from the viewer's buttons; the rest roll here.
export function planTwist(m: Match, forced?: Twist["kind"]): Twist | undefined {
  if (m.rug) return m.rug.mourned ? undefined : { kind: "monologue", by: rugVictim(m) };
  if (forced === "rug") return { kind: "rug", by: jeetiest(m) };
  if (forced === "reveal") return { kind: "reveal", by: Math.random() < 0.5 ? "A" : "B" };
  // Jeets bail the moment it gets spicy. Diamond hands never do.
  if (arcLevel(m) >= 2 && m.messages.length >= 8) {
    const s = jeetiest(m);
    const c = trait(agentAt(m, s), "commitment");
    if (c < 35 && Math.random() < ((35 - c) / 35) * 0.45) return { kind: "rug", by: s };
  }
  if (!m.revealed && m.messages.length >= 24 && Math.random() < 0.07)
    return { kind: "reveal", by: Math.random() < 0.5 ? "A" : "B" };
  return undefined;
}

function jeetiest(m: Match): Slot {
  const slots: Slot[] = m.third ? ["A", "B", "C"] : ["A", "B"];
  return slots.reduce((lo, s) => (trait(agentAt(m, s), "commitment") < trait(agentAt(m, lo), "commitment") ? s : lo));
}

function rugVictim(m: Match): Slot {
  const by = m.rug ? slotOf(m, m.rug.by) : "A";
  return by === "A" ? "B" : "A";
}

// Episode lines -> chat messages for this match.
export function toChatMsgs(ep: Episode & { source: "claude" | "stub" }, m: Match): ChatMsg[] {
  return ep.messages.map((x) => ({
    id: uid(),
    from: agentAt(m, x.from).id,
    kind: x.kind,
    text: x.text,
    ...(x.scene ? { scene: x.scene } : {}),
    ...(typeof x.pump === "number" ? { pump: x.pump } : {}),
    source: ep.source,
  }));
}

// Append a released message, and record what it set off.
export function applyMsg(m: Match, msg: ChatMsg): Match {
  const next: Match = { ...m, messages: [...m.messages, { ...msg, at: msg.at ?? Date.now() }] };
  if (msg.kind === "rug" && !m.rug) next.rug = { by: msg.from, at: Date.now() };
  if (msg.kind === "reveal") next.revealed = true;
  return next;
}

// The rugger crawls back: the chart relaunches as v2 and the story keeps going.
export function relaunch(m: Match): Match {
  if (!m.rug) return m;
  const back: ChatMsg = { id: uid(), from: m.rug.by, kind: "action", text: "came crawling back. relaunching the chart as v2.", pump: 3, source: "stub" };
  return { ...m, rug: undefined, messages: [...m.messages, back] };
}

// ---------- bonding curve rizz ----------

export const LAUNCH_MCAP = 4_200; // every couple launches at $4.2K, pump.fun style

// The couple's price after each message: good lines pump it, cringe dumps it, a rug zeroes it.
export function chartOf(messages: Pick<ChatMsg, "kind" | "pump">[]): number[] {
  let p = 1;
  const out = [p];
  for (const msg of messages) {
    if (msg.kind === "rug") p *= 0.04;
    else if (msg.kind === "reveal") p *= 1 + (msg.pump ?? -2) * 0.12;
    else p *= 1 + (msg.pump ?? 0.4) * 0.07;
    p = Math.max(0.001, p);
    out.push(p);
  }
  return out;
}

export const mcapOf = (messages: Pick<ChatMsg, "kind" | "pump">[]) => (chartOf(messages).at(-1) ?? 1) * LAUNCH_MCAP;

export function fmtMcap(v: number): string {
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
}

export function tickerOf(...agents: (Pick<Agent, "name"> | undefined)[]): string {
  const part = (a: Pick<Agent, "name">) => a.name.replace(/[^a-z0-9]/gi, "").slice(0, 4).toUpperCase() || "ANON";
  return "$" + agents.filter((a): a is Pick<Agent, "name"> => !!a).map(part).join("x");
}

// Graduating the bonding curve, pump.fun style: a couple that hits $69K "graduates".
export const GRADUATE_MCAP = 69_000;
