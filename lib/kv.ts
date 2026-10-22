import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

// Tiny key-value store for claimed agents.
// Production: Upstash Redis over REST (free tier; also what Vercel's KV integration gives you),
// configured with UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN (or the KV_REST_API_* names).
// Local dev without those: a JSON file in .data/ (do not rely on it on Vercel, its disk is wiped).

const URL_ = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
export type Ns = "kols" | "drafts";
const hashOf = (ns: Ns) => `gradient:${ns}`;
const fileOf = (ns: Ns) => `.data/${ns}.json`;

export const kvConfigured = () => !!(URL_ && TOKEN);

async function redis<T>(...cmd: (string | number)[]): Promise<T> {
  const res = await fetch(URL_!, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify(cmd),
    cache: "no-store",
  });
  const data = (await res.json()) as { result?: T; error?: string };
  if (!res.ok || data.error) throw new Error(`redis: ${data.error ?? res.status}`);
  return data.result as T;
}

function readFile(ns: Ns): Record<string, string> {
  try {
    return JSON.parse(readFileSync(fileOf(ns), "utf8"));
  } catch {
    return {};
  }
}

function writeFile(ns: Ns, v: Record<string, string>) {
  mkdirSync(".data", { recursive: true });
  writeFileSync(fileOf(ns), JSON.stringify(v));
}

export async function kvAll(ns: Ns): Promise<Record<string, string>> {
  if (!kvConfigured()) return readFile(ns);
  const flat = await redis<string[]>("HGETALL", hashOf(ns));
  const out: Record<string, string> = {};
  for (let i = 0; i < flat.length; i += 2) out[flat[i]] = flat[i + 1];
  return out;
}

export async function kvGet(ns: Ns, field: string): Promise<string | null> {
  if (!kvConfigured()) return readFile(ns)[field] ?? null;
  return redis<string | null>("HGET", hashOf(ns), field);
}

export async function kvSet(ns: Ns, field: string, value: string) {
  if (!kvConfigured()) return writeFile(ns, { ...readFile(ns), [field]: value });
  await redis("HSET", hashOf(ns), field, value);
}

export async function kvDel(ns: Ns, field: string) {
  if (!kvConfigured()) {
    const all = readFile(ns);
    delete all[field];
    return writeFile(ns, all);
  }
  await redis("HDEL", hashOf(ns), field);
}

// Counter with expiry (used for the daily voice budget). Falls back to process memory.
const mem = new Map<string, number>();
export async function kvIncr(key: string, by: number, ttlSeconds: number): Promise<number> {
  if (!kvConfigured()) {
    const v = (mem.get(key) ?? 0) + by;
    mem.set(key, v);
    return v;
  }
  const v = await redis<number>("INCRBY", `gradient:${key}`, by);
  if (v === by) await redis("EXPIRE", `gradient:${key}`, ttlSeconds);
  return v;
}
