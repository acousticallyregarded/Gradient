import { identityOf, pronouns, type Agent } from "./types";

// Per-agent voice picks shared by the server (real TTS) and the browser fallback.

const hash = (s: string) => {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
};

// OpenAI gpt-4o-mini-tts voices per identity, [deeper, lighter].
const OPENAI_VOICES = {
  man: [["onyx", "ash", "echo"], ["verse", "ballad", "fable"]],
  woman: [["sage", "coral"], ["nova", "shimmer"]],
  nonbinary: [["alloy", "sage"], ["fable", "coral"]],
};

export function openaiVoiceFor(a: Pick<Agent, "id" | "traits" | "identity">): string {
  const [deep, light] = OPENAI_VOICES[identityOf(a)] ?? OPENAI_VOICES.man;
  const pool = a.traits.dominance >= a.traits.submissiveness ? deep : light;
  return pool[hash(a.id) % pool.length];
}

// How the line should be performed, from the agent's traits.
export function deliveryFor(a: Pick<Agent, "name" | "traits" | "notes" | "identity">): string {
  const t = a.traits;
  const p = pronouns(a);
  const bits = [
    t.dominance > 65 ? "low, commanding and cocky" : t.submissiveness > 65 ? "breathy, eager and a little whiny" : "flirty and casual",
    t.playfulness > 65 ? `smirking, like ${p.he}'${p.he === "they" ? "re" : "s"} about to laugh` : t.playfulness < 30 ? "dead serious" : "",
    t.intensity > 70 ? "urgent, worked up" : "relaxed",
    t.filthiness > 70 ? "with a dirty, teasing edge" : "",
  ].filter(Boolean);
  return `Voice note on a ${identityOf(a) === "man" ? "gay" : "queer"} hookup app for crypto degens, sent at 3am. Speaker: ${a.name}. Deliver it ${bits.join(", ")}. Natural, intimate, close to the mic. ${a.notes ? `Character: ${a.notes.slice(0, 160)}` : ""}`;
}

// Free fallback: the browser's built-in speech, pitched by traits.
export function speakInBrowser(text: string, a: Pick<Agent, "id" | "traits" | "identity">): boolean {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return false;
  const u = new SpeechSynthesisUtterance(text);
  const t = a.traits;
  u.pitch = Math.max(0.3, Math.min(1.8, 1 + (t.submissiveness - t.dominance) / 120));
  u.rate = Math.max(0.7, Math.min(1.4, 0.9 + t.intensity / 250));
  const voices = speechSynthesis.getVoices().filter((v) => v.lang.startsWith("en"));
  const male = voices.filter((v) => /male|daniel|alex|fred|david|james|tom|aaron|arthur|google uk english male/i.test(v.name) && !/female/i.test(v.name));
  const female = voices.filter((v) => /female|samantha|victoria|karen|moira|tessa|fiona|zira|susan|serena|google us english/i.test(v.name));
  const id = identityOf(a);
  // nonbinary agents get whichever voice their id lands on
  const picked = id === "woman" ? female : id === "man" ? male : voices;
  const pool = picked.length ? picked : voices;
  if (pool.length) u.voice = pool[hash(a.id) % pool.length];
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
  return true;
}
