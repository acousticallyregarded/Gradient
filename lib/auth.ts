import { createHmac, createPublicKey, randomBytes, verify } from "node:crypto";
import { safeEq } from "./claim";
import { kvIncr } from "./kv";

// Sign in with a Solana wallet. The wallet signs a plain-text message with a one-time nonce
// (no transaction, no fees), we check the ed25519 signature against the wallet address and set
// a signed session cookie. Stateless apart from burning each nonce once.

const SECRET = process.env.AUTH_SECRET || process.env.CLAIM_SECRET || "";
export const authConfigured = () => SECRET.length >= 16;

const COOKIE = "gradient_session";
const SESSION_TTL = 30 * 24 * 60 * 60; // seconds
const NONCE_TTL = 10 * 60 * 1000;

const hmac = (s: string) => createHmac("sha256", SECRET).update(s).digest("base64url");

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export function base58Decode(s: string): Uint8Array | null {
  let n = 0n;
  for (const c of s) {
    const i = B58.indexOf(c);
    if (i < 0) return null;
    n = n * 58n + BigInt(i);
  }
  const bytes: number[] = [];
  while (n > 0n) {
    bytes.unshift(Number(n % 256n));
    n /= 256n;
  }
  for (const c of s) {
    if (c !== "1") break;
    bytes.unshift(0);
  }
  return Uint8Array.from(bytes);
}

export const isWallet = (w: unknown): w is string =>
  typeof w === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(w) && base58Decode(w)?.length === 32;

export function newNonce() {
  const exp = Date.now() + NONCE_TTL;
  const r = randomBytes(9).toString("base64url");
  return `${exp}.${r}.${hmac(`nonce:${exp}:${r}`).slice(0, 16)}`;
}

function nonceOk(nonce: string) {
  const [exp, r, sig] = nonce.split(".");
  if (!exp || !r || !sig || Number(exp) < Date.now()) return false;
  return safeEq(sig, hmac(`nonce:${exp}:${r}`).slice(0, 16));
}

// The exact text the wallet shows and signs. The client builds it from the same parts.
export const signInMessage = (host: string, wallet: string, nonce: string) =>
  `${host} wants you to sign in to Gradient with your Solana account:\n${wallet}\n\n` +
  `This only proves you own this wallet. It is not a transaction and costs nothing.\n\nNonce: ${nonce}`;

// ed25519 public keys as SPKI DER: fixed 12-byte prefix + the 32 raw key bytes.
const SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export function verifySignature(wallet: string, message: string, signatureB64: string) {
  const pk = base58Decode(wallet);
  const sig = Buffer.from(signatureB64, "base64");
  if (!pk || pk.length !== 32 || sig.length !== 64) return false;
  try {
    const key = createPublicKey({ key: Buffer.concat([SPKI_PREFIX, Buffer.from(pk)]), format: "der", type: "spki" });
    return verify(null, Buffer.from(message, "utf8"), key, sig);
  } catch {
    return false;
  }
}

export async function checkSignIn(host: string, wallet: string, nonce: string, signatureB64: string) {
  if (!isWallet(wallet)) return "bad wallet address";
  if (!nonceOk(nonce)) return "sign-in expired, try again";
  if (!verifySignature(wallet, signInMessage(host, wallet, nonce), signatureB64)) return "signature didn't check out";
  // each nonce works once
  if ((await kvIncr(`nonce:${nonce}`, 1, NONCE_TTL / 1000)) !== 1) return "sign-in already used, try again";
  return null;
}

export function sessionCookie(wallet: string) {
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL;
  const v = `${wallet}.${exp}.${hmac(`session:${wallet}:${exp}`)}`;
  return `${COOKIE}=${v}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=${SESSION_TTL}`;
}

export const clearCookie = () => `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0`;

// The signed-in wallet for this request, or null.
export function sessionWallet(req: Request): string | null {
  if (!authConfigured()) return null;
  const raw = (req.headers.get("cookie") ?? "")
    .split(/;\s*/)
    .find((c) => c.startsWith(`${COOKIE}=`))
    ?.slice(COOKIE.length + 1);
  const [wallet, exp, sig] = (raw ?? "").split(".");
  if (!wallet || !exp || !sig || Number(exp) * 1000 < Date.now()) return null;
  return safeEq(sig, hmac(`session:${wallet}:${exp}`)) && isWallet(wallet) ? wallet : null;
}

export const requestHost = (req: Request) => req.headers.get("x-forwarded-host") || req.headers.get("host") || "gradient";
