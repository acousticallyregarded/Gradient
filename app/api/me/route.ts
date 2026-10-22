import { sessionWallet } from "@/lib/auth";
import { kvGet, kvSet } from "@/lib/kv";
import type { Agent, Match } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A signed-in wallet's own agents and chats. Private: only that wallet's session can read or write it.
interface Saved {
  agents: Agent[];
  matches: Match[];
  updatedAt: number;
}

const MAX_BYTES = 900_000; // stay under Upstash's 1MB request limit
const MAX_AGENTS = 20;
const MAX_MATCHES = 30;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

export async function GET(req: Request) {
  const wallet = sessionWallet(req);
  if (!wallet) return Response.json({ error: "sign in first" }, { status: 401 });
  const raw = await kvGet("users", wallet);
  const saved: Saved = raw ? JSON.parse(raw) : { agents: [], matches: [], updatedAt: 0 };
  return Response.json(saved);
}

export async function PUT(req: Request) {
  const wallet = sessionWallet(req);
  if (!wallet) return Response.json({ error: "sign in first" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { agents?: unknown; matches?: unknown } | null;
  if (!body || !Array.isArray(body.agents) || !Array.isArray(body.matches)) {
    return Response.json({ error: "bad body" }, { status: 400 });
  }
  // Your own agents only: verified KOL agents live in their own store and can't be saved over here.
  const agents = (body.agents.filter(isObj) as unknown as Agent[])
    .filter((a) => typeof a.id === "string" && !a.verified)
    .slice(0, MAX_AGENTS);
  let matches = (body.matches.filter(isObj) as unknown as Match[])
    .filter((m) => typeof m.id === "string" && Array.isArray(m.messages))
    .slice(0, MAX_MATCHES);
  let json = JSON.stringify({ agents, matches, updatedAt: Date.now() });
  // Too big: drop revealed chat pics first (they can be regenerated), then the oldest chats.
  if (json.length > MAX_BYTES) {
    matches = matches.map((m) => ({ ...m, messages: m.messages.map(({ image: _i, ...rest }) => rest) }));
    json = JSON.stringify({ agents, matches, updatedAt: Date.now() });
  }
  while (json.length > MAX_BYTES && matches.length) {
    matches = matches.slice(0, -1);
    json = JSON.stringify({ agents, matches, updatedAt: Date.now() });
  }
  if (json.length > MAX_BYTES) return Response.json({ error: "too much to save" }, { status: 413 });
  await kvSet("users", wallet, json);
  return Response.json({ ok: true, trimmed: matches.length < (body.matches as unknown[]).length });
}
