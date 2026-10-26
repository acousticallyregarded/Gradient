import { kvIncr } from "@/lib/kv";
import type { Agent } from "@/lib/types";
import { deliveryFor, openaiVoiceFor } from "@/lib/voice";

export const runtime = "nodejs";

// Real voice notes. VOICE_PROVIDER = "openai" (default when OPENAI_API_KEY is set) or "elevenlabs".
// Audio is only made when someone taps play, cached per instance, and capped per day by characters.

const PROVIDER = process.env.VOICE_PROVIDER || (process.env.ELEVENLABS_API_KEY && !process.env.OPENAI_API_KEY ? "elevenlabs" : "openai");
const DAILY_CHARS = Number(process.env.VOICE_DAILY_CHAR_LIMIT || 200_000);
// ElevenLabs voice ids from your Voice Library, comma separated: deep voices first, then lighter ones after a "|".
// e.g. ELEVENLABS_VOICES="idDeep1,idDeep2|idLight1,idLight2"
const EL_VOICES = (process.env.ELEVENLABS_VOICES || "").split("|").map((s) => s.split(",").map((x) => x.trim()).filter(Boolean));

const cache = new Map<string, ArrayBuffer>();

type Speaker = Pick<Agent, "id" | "name" | "traits" | "notes" | "identity">;

async function openai(text: string, a: Speaker): Promise<Response> {
  return fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts",
      voice: openaiVoiceFor(a),
      input: text,
      instructions: deliveryFor(a),
      response_format: "mp3",
    }),
  });
}

async function elevenlabs(text: string, a: Speaker): Promise<Response> {
  const deep = EL_VOICES[0] ?? [];
  const light = EL_VOICES[1]?.length ? EL_VOICES[1] : deep;
  const pool = a.traits.dominance >= a.traits.submissiveness ? deep : light;
  if (!pool.length) return new Response("set ELEVENLABS_VOICES", { status: 500 });
  let h = 0;
  for (const c of a.id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const voice = pool[h % pool.length];
  return fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_64`, {
    method: "POST",
    headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY!, "content-type": "application/json", accept: "audio/mpeg" },
    body: JSON.stringify({
      text,
      model_id: process.env.ELEVENLABS_MODEL || "eleven_flash_v2_5",
      voice_settings: { stability: 0.35, similarity_boost: 0.8, style: Math.min(1, a.traits.intensity / 100) },
    }),
  });
}

export async function POST(req: Request) {
  const keyed = PROVIDER === "elevenlabs" ? !!process.env.ELEVENLABS_API_KEY : !!process.env.OPENAI_API_KEY;
  if (!keyed) return Response.json({ fallback: true, reason: "no_key" }, { status: 503 });

  const { text: raw, agent } = (await req.json()) as { text?: string; agent?: Speaker };
  const text = String(raw ?? "").replace(/[*_]/g, "").trim().slice(0, 400);
  if (!text || !agent?.traits) return Response.json({ error: "bad request" }, { status: 400 });

  const ck = `${PROVIDER}:${agent.id}:${text}`;
  const hit = cache.get(ck);
  if (hit) return new Response(hit, { headers: { "content-type": "audio/mpeg", "cache-control": "private, max-age=86400" } });

  const day = new Date().toISOString().slice(0, 10);
  const used = await kvIncr(`voice:${day}`, text.length, 2 * 86400).catch(() => 0);
  if (used > DAILY_CHARS) return Response.json({ fallback: true, reason: "daily_cap" }, { status: 429 });

  try {
    const res = PROVIDER === "elevenlabs" ? await elevenlabs(text, agent) : await openai(text, agent);
    if (!res.ok) {
      console.error("tts error", PROVIDER, res.status, (await res.text()).slice(0, 300));
      return Response.json({ fallback: true, reason: "tts_error" }, { status: 502 });
    }
    const audio = await res.arrayBuffer();
    if (cache.size > 300) cache.delete(cache.keys().next().value!);
    cache.set(ck, audio);
    return new Response(audio, { headers: { "content-type": "audio/mpeg", "cache-control": "private, max-age=86400" } });
  } catch (e) {
    console.error(e);
    return Response.json({ fallback: true, reason: "tts_error" }, { status: 502 });
  }
}
