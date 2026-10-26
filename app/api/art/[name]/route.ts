import { artKind, artPrompt, artVersion } from "@/lib/art";
import { kvGet, kvIncr, kvLock, kvSet, kvUnlock } from "@/lib/kv";

export const runtime = "nodejs";
export const maxDuration = 60;

// The UI's pictures (icons, house-agent portraits, avatar choices). Each one is generated the first time
// anyone asks for it, shrunk, kept in KV, and served with a year-long cache from then on, so the OpenAI
// cost is a one-off of roughly a cent per image. Only names listed in lib/art.ts can be generated.

const MODEL = process.env.OPENAI_ART_MODEL || "gpt-image-1-mini";
const QUALITY = process.env.OPENAI_ART_QUALITY || "medium";
const DAILY = Number(process.env.ART_DAILY_LIMIT || 150);
const PARALLEL = 4; // OpenAI image rate limits are tight on new accounts; extra requests retry shortly

const mem = new Map<string, Buffer>();

const FOREVER = "public, max-age=31536000, s-maxage=31536000, immutable";
const img = (buf: Buffer, cache: string) =>
  new Response(new Uint8Array(buf), { headers: { "content-type": "image/webp", "cache-control": cache } });
const nope = (reason: string, status: number, retry?: number) =>
  Response.json(
    { reason },
    { status, headers: { "cache-control": "no-store", ...(retry ? { "retry-after": String(retry) } : {}) } },
  );

async function shrink(buf: Buffer, kind: string): Promise<Buffer> {
  try {
    const sharp = (await import("sharp")).default;
    const pipe = sharp(buf);
    if (kind === "portrait" || kind === "shot") pipe.resize(600, 900, { fit: "cover" });
    else pipe.resize(kind === "scene" ? 512 : 256, kind === "scene" ? 512 : 256, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } });
    return await pipe.webp({ quality: 80, alphaQuality: 90 }).toBuffer();
  } catch (e) {
    console.error("art: sharp unavailable, serving full size", e);
    return buf;
  }
}

export async function GET(req: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const prompt = artPrompt(name);
  const kind = artKind(name);
  if (!prompt || !kind) return nope("unknown", 404);
  const version = artVersion(name);
  const asked = new URL(req.url).searchParams.get("v");
  const cache = asked === version ? FOREVER : "public, max-age=300";
  const field = `${name}:${version}`;

  const hit = mem.get(field);
  if (hit) return img(hit, cache);
  const stored = await kvGet("art", field).catch(() => null);
  if (stored) {
    const buf = Buffer.from(stored, "base64");
    mem.set(field, buf);
    return img(buf, cache);
  }

  if (!process.env.OPENAI_API_KEY) return nope("no_key", 404);
  if (!(await kvLock(`artlock:${field}`, 90).catch(() => true))) return nope("generating", 503, 8);
  const inflight = await kvIncr("art:inflight", 1, 120).catch(() => 1);
  try {
    if (inflight > PARALLEL) return nope("busy", 503, 6);
    const day = new Date().toISOString().slice(0, 10);
    if ((await kvIncr(`art:${day}`, 1, 2 * 86400).catch(() => 0)) > DAILY) return nope("daily_cap", 429);

    const res = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        prompt,
        size: kind === "portrait" || kind === "shot" ? "1024x1536" : "1024x1024",
        quality: QUALITY,
        background: kind === "portrait" || kind === "shot" ? "opaque" : "transparent",
        output_format: "webp",
        output_compression: 90,
        n: 1,
      }),
    });
    const data = (await res.json()) as { data?: { b64_json?: string }[]; error?: { message?: string } };
    if (!res.ok || !data.data?.[0]?.b64_json) {
      console.error("art error", name, res.status, data.error?.message);
      return nope("error", res.status === 429 ? 503 : 502, res.status === 429 ? 20 : undefined);
    }
    const buf = await shrink(Buffer.from(data.data[0].b64_json, "base64"), kind);
    mem.set(field, buf);
    // Upstash caps a request at 1MB; anything bigger just lives in this instance's memory
    if (buf.length < 700_000) await kvSet("art", field, buf.toString("base64")).catch((e) => console.error("art save", e));
    return img(buf, cache);
  } catch (e) {
    console.error("art", name, e);
    return nope("error", 502);
  } finally {
    await kvIncr("art:inflight", -1, 120).catch(() => {});
    await kvUnlock(`artlock:${field}`).catch(() => {});
  }
}
