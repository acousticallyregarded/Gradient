import { isAdmin, checkToken, hashKey, newManageKey, normHandle, safeEq } from "@/lib/claim";
import { kvAll, kvDel, kvGet, kvSet } from "@/lib/kv";
import { moderateImage } from "@/lib/moderation";
import { TRAIT_META, type Agent } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Stored {
  agent: Agent;
  keyHash: string;
  claimedAt: number;
}

const clip = (v: unknown, n: number) => String(v ?? "").slice(0, n);
const num = (v: unknown, lo: number, hi: number, d: number) => {
  const x = Number(v);
  return Number.isFinite(x) ? Math.max(lo, Math.min(hi, Math.round(x))) : d;
};

function sanitize(handle: string, a: Partial<Agent>, photo: string | undefined): Agent {
  const traits = Object.fromEntries(
    TRAIT_META.map((m) => [m.key, num(a.traits?.[m.key], 0, 100, 50)]),
  ) as Agent["traits"];
  return {
    id: `kol-${handle}`,
    name: clip(a.name, 24) || `@${handle}`,
    age: num(a.age, 18, 99, 30),
    bio: clip(a.bio, 160),
    look: clip(a.look, 100),
    emoji: clip(a.emoji, 8) || "✅",
    photo,
    hue: num(a.hue, 0, 359, 150),
    traits,
    notes: clip(a.notes, 300),
    tags: (Array.isArray(a.tags) ? a.tags : []).slice(0, 5).map((t) => clip(t, 20)),
    position: a.position ? clip(a.position, 20) : undefined,
    tribe: "KOL",
    height: a.height ? clip(a.height, 8) : undefined,
    bodyType: a.bodyType ? clip(a.bodyType, 20) : undefined,
    lookingFor: a.lookingFor ? clip(a.lookingFor, 40) : undefined,
    verified: true,
    handle,
    allowFeed: a.allowFeed === true,
    createdAt: Date.now(),
  };
}

// Everyone's grid pulls verified agents from here.
export async function GET() {
  try {
    const all = await kvAll("kols");
    const agents = Object.values(all)
      .map((v) => (JSON.parse(v) as Stored).agent)
      .sort((x, y) => x.createdAt - y.createdAt);
    return Response.json({ agents });
  } catch (e) {
    console.error(e);
    return Response.json({ agents: [] });
  }
}

// Publish or update a claimed agent. New claims need the token from tweet verification;
// edits need the manage key handed out at first publish.
export async function POST(req: Request) {
  const body = (await req.json()) as {
    token?: string;
    handle?: string;
    manageKey?: string;
    agent?: Partial<Agent>;
    consent?: boolean;
  };
  if (body.consent !== true) return Response.json({ error: "tick the consent box first" }, { status: 400 });

  let handle = checkToken(body.token);
  const prevRaw = await kvGet("kols", handle ?? normHandle(body.handle ?? "") ?? "");
  const prev = prevRaw ? (JSON.parse(prevRaw) as Stored) : null;
  if (!handle && prev && body.manageKey && safeEq(hashKey(body.manageKey), prev.keyHash)) handle = prev.agent.handle!;
  if (!handle) return Response.json({ error: "verification expired, verify your tweet again" }, { status: 401 });

  let photo = prev?.agent.photo;
  const incoming = body.agent?.photo;
  if (incoming === undefined || incoming === null || incoming === "") photo = undefined;
  else if (incoming !== prev?.agent.photo) {
    const r = await moderateImage(incoming);
    if ("error" in r) return Response.json({ error: "couldn't check that pic, try another" }, { status: 400 });
    if (!r.allowed) return Response.json({ error: `pic blocked: ${r.reason || "too much"}` }, { status: 400 });
    photo = incoming;
  }

  const agent = sanitize(handle, body.agent ?? {}, photo);
  if (prev) agent.createdAt = prev.agent.createdAt;
  const fresh = !prev || !!checkToken(body.token);
  const manageKey = fresh ? newManageKey() : undefined;
  const stored: Stored = {
    agent,
    keyHash: manageKey ? hashKey(manageKey) : prev!.keyHash,
    claimedAt: prev?.claimedAt ?? Date.now(),
  };
  await kvSet("kols", handle, JSON.stringify(stored));
  await kvDel("drafts", handle); // the draft (if any) is used up once approved
  return Response.json({ agent, manageKey });
}

// The KOL (with their manage key) or the site admin (ADMIN_KEY) can take an agent down.
export async function DELETE(req: Request) {
  const { handle: raw, manageKey } = (await req.json()) as { handle?: string; manageKey?: string };
  const handle = normHandle(raw ?? "");
  if (!handle) return Response.json({ error: "bad handle" }, { status: 400 });
  const admin = isAdmin(req);
  const prevRaw = await kvGet("kols", handle);
  if (!prevRaw) return Response.json({ ok: true });
  const prev = JSON.parse(prevRaw) as Stored;
  if (!admin && !(manageKey && safeEq(hashKey(manageKey), prev.keyHash))) {
    return Response.json({ error: "not allowed" }, { status: 403 });
  }
  await kvDel("kols", handle);
  return Response.json({ ok: true });
}
