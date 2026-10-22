import { hashKey, isAdmin, safeEq } from "@/lib/claim";
import { kvDel, kvGet, kvIncr, kvSet } from "@/lib/kv";
import { clientIp, type FeedItem, type StoredPost } from "@/lib/posts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };
const HIDE_AT = Number(process.env.POST_REPORTS_TO_HIDE || 3);

async function load(id: string) {
  const [p, f] = await Promise.all([kvGet("posts", id), kvGet("feed", id)]);
  return p && f ? { stored: JSON.parse(p) as StoredPost, item: JSON.parse(f) as FeedItem } : null;
}

export async function GET(req: Request, { params }: Ctx) {
  const got = await load((await params).id);
  if (!got || (got.item.hidden && !isAdmin(req))) return Response.json({ error: "post not found" }, { status: 404 });
  return Response.json({ post: got.stored.post, fire: got.item.fire });
}

// 🔥 or report, once per visitor (by IP) per post. Enough reports hide the post until the admin looks.
export async function POST(req: Request, { params }: Ctx) {
  const id = (await params).id;
  const { action } = (await req.json().catch(() => ({}))) as { action?: string };
  if (action !== "fire" && action !== "report") return Response.json({ error: "bad action" }, { status: 400 });
  const got = await load(id);
  if (!got) return Response.json({ error: "post not found" }, { status: 404 });
  const first = (await kvIncr(`${action}:${id}:${clientIp(req)}`, 1, 90 * 86400).catch(() => 1)) === 1;
  if (first) {
    const item = got.item;
    if (action === "fire") item.fire++;
    else if (++item.reports >= HIDE_AT) item.hidden = true;
    await kvSet("feed", id, JSON.stringify(item));
  }
  return Response.json({ fire: got.item.fire, hidden: !!got.item.hidden });
}

// The poster (with the key they got when posting) or the admin can take a post down.
// The admin can also restore a reported post with { restore: true }.
export async function DELETE(req: Request, { params }: Ctx) {
  const id = (await params).id;
  const { deleteKey, restore } = (await req.json().catch(() => ({}))) as { deleteKey?: string; restore?: boolean };
  const got = await load(id);
  if (!got) return Response.json({ ok: true });
  const admin = isAdmin(req);
  if (!admin && !(deleteKey && safeEq(hashKey(deleteKey), got.stored.deleteHash))) {
    return Response.json({ error: "not allowed" }, { status: 403 });
  }
  if (admin && restore) {
    await kvSet("feed", id, JSON.stringify({ ...got.item, hidden: false, reports: 0 }));
    return Response.json({ ok: true, restored: true });
  }
  await Promise.all([kvDel("posts", id), kvDel("feed", id)]);
  return Response.json({ ok: true });
}
