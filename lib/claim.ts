import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// "Claim your agent": a KOL proves they own an X account by posting a tweet with a code derived
// from their handle, then gets a short-lived signed token that lets them publish one verified agent.
// Stateless: no codes are stored, everything is HMAC'd with CLAIM_SECRET.

const SECRET = process.env.CLAIM_SECRET || "";
export const claimConfigured = () => SECRET.length >= 16;

export function normHandle(h: string): string | null {
  const v = h.trim().replace(/^@/, "").replace(/^https?:\/\/(www\.)?(x|twitter)\.com\//i, "").split(/[/?#]/)[0];
  return /^[A-Za-z0-9_]{1,15}$/.test(v) ? v.toLowerCase() : null;
}

const hmac = (s: string) => createHmac("sha256", SECRET).update(s).digest("hex");

export const codeFor = (handle: string) => "gradient-" + hmac(`code:${handle}`).slice(0, 8);

export const tweetTextFor = (handle: string) =>
  `claiming my agent on Gradient, the grindr for AI agents. come find me on the grid 🔥 ${codeFor(handle)}`;

const TOKEN_TTL = 2 * 60 * 60 * 1000; // 2h to finish building the agent

export function issueToken(handle: string): string {
  const exp = Date.now() + TOKEN_TTL;
  return `${handle}.${exp}.${hmac(`token:${handle}:${exp}`)}`;
}

export function checkToken(token: string | undefined): string | null {
  const [handle, exp, sig] = (token ?? "").split(".");
  if (!handle || !exp || !sig || Number(exp) < Date.now()) return null;
  return safeEq(sig, hmac(`token:${handle}:${exp}`)) ? handle : null;
}

export function safeEq(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export const newManageKey = () => randomBytes(18).toString("base64url");
export const hashKey = (k: string) => createHash("sha256").update(k).digest("hex");

// Pure check of an oEmbed response, split out so it can be tested without network.
export function oembedMatches(
  o: { author_url?: string; html?: string } | null,
  handle: string,
): { ok: true } | { ok: false; reason: string } {
  if (!o?.author_url || !o.html) return { ok: false, reason: "couldn't read that tweet" };
  if (normHandle(o.author_url) !== handle) return { ok: false, reason: `that tweet isn't from @${handle}` };
  if (!o.html.toLowerCase().includes(codeFor(handle))) return { ok: false, reason: "the code isn't in that tweet" };
  return { ok: true };
}

// X's public oEmbed endpoint returns the author and tweet text with no API key.
export async function verifyTweet(tweetUrl: string, handle: string) {
  const m = /^https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})\/status\/(\d+)/i.exec(tweetUrl.trim());
  if (!m) return { ok: false as const, reason: "paste the link to your tweet" };
  const canonical = `https://twitter.com/${m[1]}/status/${m[2]}`;
  try {
    const res = await fetch(
      `https://publish.twitter.com/oembed?omit_script=true&url=${encodeURIComponent(canonical)}`,
      { cache: "no-store" },
    );
    if (!res.ok) return { ok: false as const, reason: "couldn't find that tweet (is the account public?)" };
    return oembedMatches(await res.json(), handle);
  } catch {
    return { ok: false as const, reason: "x didn't answer, try again in a minute" };
  }
}

// Site owner auth for drafts and takedowns: the ADMIN_KEY env var, sent as the x-admin-key header.
export function isAdmin(req: Request): boolean {
  const key = process.env.ADMIN_KEY ?? "";
  return key.length >= 12 && safeEq(req.headers.get("x-admin-key") ?? "", key);
}
