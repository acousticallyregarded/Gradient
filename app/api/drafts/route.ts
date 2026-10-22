import { checkToken, isAdmin, normHandle } from "@/lib/claim";
import { kvAll, kvDel, kvGet, kvSet } from "@/lib/kv";
import type { Agent } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Prebuilt KOL agents. Private: only the admin, or the KOL after proving they own the handle,
// can read one. Drafts never appear on the grid or in chats; approving moves it to /api/kols.

interface Draft {
  agent: Partial<Agent>;
  createdAt: number;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  if (token) {
    const handle = checkToken(token);
    if (!handle) return Response.json({ error: "verification expired" }, { status: 401 });
    const raw = await kvGet("drafts", handle);
    return Response.json({ draft: raw ? (JSON.parse(raw) as Draft).agent : null });
  }
  if (!isAdmin(req)) return Response.json({ error: "not allowed" }, { status: 403 });
  const [drafts, kols] = await Promise.all([kvAll("drafts"), kvAll("kols")]);
  return Response.json({
    drafts: Object.entries(drafts).map(([handle, v]) => ({ handle, ...(JSON.parse(v) as Draft) })),
    live: Object.keys(kols),
  });
}

export async function POST(req: Request) {
  if (!isAdmin(req)) return Response.json({ error: "not allowed" }, { status: 403 });
  const { handle: raw, agent } = (await req.json()) as { handle?: string; agent?: Partial<Agent> };
  const handle = normHandle(raw ?? "");
  if (!handle || !agent) return Response.json({ error: "need a handle and an agent" }, { status: 400 });
  // the KOL adds their own pic when they approve; drafts never carry one
  const { photo: _photo, ...rest } = agent;
  const draft: Draft = { agent: { ...rest, handle }, createdAt: Date.now() };
  await kvSet("drafts", handle, JSON.stringify(draft));
  return Response.json({ ok: true, handle });
}

// Admin deletes a draft, or the KOL declines it after verifying.
export async function DELETE(req: Request) {
  const { handle: raw, token } = (await req.json()) as { handle?: string; token?: string };
  const handle = isAdmin(req) ? normHandle(raw ?? "") : checkToken(token);
  if (!handle) return Response.json({ error: "not allowed" }, { status: 403 });
  await kvDel("drafts", handle);
  return Response.json({ ok: true });
}
