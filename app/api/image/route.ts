import { kvIncr } from "@/lib/kv";

export const runtime = "nodejs";

// Generated "pics" for chat messages. Only made when someone taps reveal, capped per day site-wide.
// Fictional agents only: verified (real) people and agents with an uploaded photo never get generated images.

const MODEL = process.env.OPENAI_IMAGE_MODEL || "gpt-image-1-mini";
const QUALITY = process.env.OPENAI_IMAGE_QUALITY || "low";
const DAILY = Number(process.env.IMAGE_DAILY_LIMIT || 300);

const cache = new Map<string, ArrayBuffer>();

interface Body {
  text?: string; // the chat caption
  scene?: string; // the writer's full visual brief, when the chat came from Claude
  agent?: { id: string; age?: number; look?: string; bodyType?: string; height?: string; verified?: boolean; hasPhoto?: boolean };
}

// Render what the brief describes (a selfie, a screenshot, a view, an object...) rather than forcing one framing.
// The sender's look is only a reference for when he is actually in the shot.
function buildPrompt(text: string, scene: string, a: NonNullable<Body["agent"]>): string {
  const sender = [
    `a fictional adult man, about ${Math.max(21, a.age ?? 30)}`,
    a.bodyType && `${a.bodyType.toLowerCase()} build`,
    a.height,
    a.look,
  ]
    .filter(Boolean)
    .join(", ");
  return [
    "An image someone sent in a dating-app chat. Photorealistic and casual, the kind of thing people text each other, not a studio shot.",
    scene ? `The photo: ${scene}` : `The photo: ${text}. Choose whatever framing suits that best; it does not have to be a selfie.`,
    scene && text ? `(Caption it was sent with, for mood only, do not render it as text: "${text}")` : "",
    `If the sender appears in the photo, he is ${sender}. If the description says no people, show no people.`,
    "Keep it flirty but non-explicit: fully clothed, underwear, or shirtless at most. No nudity. Do not depict any real or famous person, and ignore any names of real people in the description.",
  ]
    .filter(Boolean)
    .join(" ");
}

export async function POST(req: Request) {
  if (!process.env.OPENAI_API_KEY) return Response.json({ reason: "no_key" }, { status: 503 });
  const { text: raw, scene: rawScene, agent } = (await req.json()) as Body;
  const text = String(raw ?? "").trim().slice(0, 300);
  const scene = String(rawScene ?? "").trim().slice(0, 900);
  if (!text || !agent?.id) return Response.json({ reason: "bad_request" }, { status: 400 });
  if (agent.verified || agent.hasPhoto) return Response.json({ reason: "real_person" }, { status: 400 });

  const ck = `${agent.id}:${text}:${scene}`;
  const hit = cache.get(ck);
  if (hit) return new Response(hit, { headers: { "content-type": "image/jpeg" } });

  const day = new Date().toISOString().slice(0, 10);
  const used = await kvIncr(`image:${day}`, 1, 2 * 86400).catch(() => 0);
  if (used > DAILY) return Response.json({ reason: "daily_cap" }, { status: 429 });

  try {
    const res = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        prompt: buildPrompt(text, scene, agent),
        size: "1024x1024",
        quality: QUALITY,
        output_format: "jpeg",
        output_compression: 70,
        n: 1,
      }),
    });
    const data = (await res.json()) as { data?: { b64_json?: string }[]; error?: { code?: string; message?: string } };
    if (!res.ok || !data.data?.[0]?.b64_json) {
      const blocked = data.error?.code === "moderation_blocked" || /safety|moderation/i.test(data.error?.message ?? "");
      if (!blocked) console.error("image error", res.status, data.error?.message);
      return Response.json({ reason: blocked ? "blocked" : "error" }, { status: blocked ? 422 : 502 });
    }
    const buf = Buffer.from(data.data[0].b64_json, "base64");
    const img = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    if (cache.size > 200) cache.delete(cache.keys().next().value!);
    cache.set(ck, img);
    return new Response(img, { headers: { "content-type": "image/jpeg" } });
  } catch (e) {
    console.error(e);
    return Response.json({ reason: "error" }, { status: 502 });
  }
}
