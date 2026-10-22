import { hashKey, isAdmin, newManageKey } from "@/lib/claim";
import { kvAll, kvIncr, kvSet } from "@/lib/kv";
import { buildPost, clientIp, dropImages, feedItem, reviewPost, type FeedItem, type PublicPost, type StoredPost } from "@/lib/posts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PER_DAY = Number(process.env.POSTS_PER_DAY || 10);

// The public feed: newest first, or ?sort=hot by 🔥. Reported-away posts only show for the admin.
export async function GET(req: Request) {
  const admin = isAdmin(req);
  const hot = new URL(req.url).searchParams.get("sort") === "hot";
  try {
    const items = Object.values(await kvAll("feed"))
      .map((v) => JSON.parse(v) as FeedItem)
      .filter((p) => admin || !p.hidden)
      .sort((x, y) => (hot ? y.fire - x.fire : 0) || y.postedAt - x.postedAt)
      .slice(0, admin ? 500 : 100);
    return Response.json({ posts: items });
  } catch (e) {
    console.error(e);
    return Response.json({ posts: [] });
  }
}

// Post a chat. The poster ticked the "post publicly" box in the app; everything is rebuilt and
// reviewed here before anyone else can see it.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  if (body.consent !== true) return Response.json({ error: "tick the box to post publicly" }, { status: 400 });

  const built = await buildPost(body);
  if ("error" in built) return Response.json({ error: built.error }, { status: 400 });

  const day = new Date().toISOString().slice(0, 10);
  const used = await kvIncr(`posts:${clientIp(req)}:${day}`, 1, 2 * 86400).catch(() => 0);
  if (used > PER_DAY) return Response.json({ error: "that's enough posting for today" }, { status: 429 });

  const review = await reviewPost(built.post, built.kolHandles);
  if ("error" in review) {
    return Response.json({ error: review.error === "no_key" ? "posting is off on this site" : "couldn't check it right now, try again" }, { status: 503 });
  }
  if (!review.allowed) return Response.json({ error: `can't post this: ${review.reason || "breaks the rules"}` }, { status: 422 });

  const before = built.post.messages.filter((m) => m.image).length;
  const id = newManageKey().slice(0, 10).replace(/[-_]/g, "x");
  const post: PublicPost = { ...dropImages(built.post, review.dropImages), id, postedAt: Date.now() };
  const deleteKey = newManageKey();
  const stored: StoredPost = { post, deleteHash: hashKey(deleteKey) };
  await kvSet("posts", id, JSON.stringify(stored));
  await kvSet("feed", id, JSON.stringify(feedItem(post)));
  return Response.json({ id, deleteKey, droppedPics: before - post.messages.filter((m) => m.image).length });
}
