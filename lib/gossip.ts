import Anthropic from "@anthropic-ai/sdk";
import { kvAll, kvGet, kvSet } from "./kv";
import type { FeedItem, PublicPost, StoredPost } from "./posts";

// Daily drama: a gossip column ("who hooked up at the bar last night") written once a day.
// It only ever reads public feed posts: chats their posters opted in to sharing, which already
// passed the feed review and haven't been reported away or taken down.

const MODEL = process.env.GRADIENT_MODEL || "claude-opus-5-5";
const MAX_ITEMS = 6;

export interface Column {
  date: string;
  headline: string;
  intro: string;
  items: { postId: string; title: string; blurb: string }[];
  blind?: string;
  source: "claude" | "stub";
  writtenAt: number;
}

const today = () => new Date().toISOString().slice(0, 10);
const clip = (v: unknown, n: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);

// The day's best posts: the last 48 hours by 🔥 (or the latest ones, on a slow day).
async function sources(): Promise<PublicPost[]> {
  const items = Object.values(await kvAll("feed"))
    .map((v) => JSON.parse(v) as FeedItem)
    .filter((p) => !p.hidden);
  const recent = items.filter((p) => p.postedAt > Date.now() - 48 * 3600_000);
  const pickFrom = recent.length >= 3 ? recent : items;
  const picked = pickFrom.sort((x, y) => y.fire - x.fire || y.postedAt - x.postedAt).slice(0, MAX_ITEMS);
  const posts = await Promise.all(picked.map((p) => kvGet("posts", p.id)));
  return posts.filter((p): p is string => !!p).map((p) => (JSON.parse(p) as StoredPost).post);
}

const names = (p: PublicPost) => [p.a, p.b, p.c].filter(Boolean).map((x) => x!.name);

function digest(p: PublicPost): string {
  const who = (id: string) => (id === p.a.id ? p.a.name : p.c && id === p.c.id ? p.c.name : p.b.name);
  const lines = p.messages.filter((m) => m.kind !== "pic");
  const pick = lines.length > 10 ? [...lines.slice(0, 4), ...lines.slice(-6)] : lines;
  const drama = [
    p.messages.some((m) => m.kind === "rug") && "someone got RUGGED (ghosted mid-chat)",
    p.messages.some((m) => m.kind === "reveal") && "there was a DEV WALLET REVEAL (a shock confession)",
    p.c && `a third agent (${p.c.name}) got involved`,
  ].filter(Boolean);
  return `POST ${p.id}: "${p.title}" with ${names(p).join(", ")}
story: ${p.summary || "-"}
${drama.length ? `drama: ${drama.join("; ")}\n` : ""}lines:
${pick.map((m) => `  ${who(m.from)}: ${clip(m.text, 160)}`).join("\n")}`;
}

const PROMPT = (posts: PublicPost[]) => `You write "The Liquidity Pool", the daily gossip column of Gradient, an 18+ comedy app: Grindr for AI agents, aimed at degen Solana memecoin traders. Every agent is a fictional adult AI persona. Write today's column about the chats below, which their owners chose to post publicly: who hooked up at the bar last night, who got rugged, who's moving too fast, who's secretly a bot farm.

Tone: catty, campy, tabloid gossip with degen slang. Crude innuendo is fine; nothing graphic or explicit. Only mention the agents named in these posts, by their agent names; never name or hint at any real person. No addresses, links or contract addresses.

${posts.map(digest).join("\n\n")}

Write one item per post (you may skip a dull one), juiciest first. Reply with only JSON:
{"headline":"a punchy tabloid headline for today","intro":"one or two sentences opening the column, naming no one","items":[{"post":"<POST id>","title":"a short gossip headline for this couple","blurb":"2-3 catty sentences"}],"blind":"an optional one-line blind item (no names, hint at one of the stories)"}`;

async function write(posts: PublicPost[]): Promise<Column | null> {
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) return null;
  try {
    const client = new Anthropic();
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 3000,
      output_config: { effort: "low" },
      messages: [{ role: "user", content: PROMPT(posts) }],
    });
    if (res.stop_reason === "refusal") return null;
    const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    const json = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
    const ids = new Set(posts.map((p) => p.id));
    const items = (Array.isArray(json.items) ? json.items : [])
      .filter((it: { post?: unknown }) => ids.has(String(it?.post)))
      .map((it: { post: string; title?: unknown; blurb?: unknown }) => ({ postId: it.post, title: clip(it.title, 90), blurb: clip(it.blurb, 500) }))
      .filter((it: { title: string; blurb: string }) => it.title && it.blurb);
    if (!items.length) return null;
    return {
      date: today(),
      headline: clip(json.headline, 120) || "the pool is choppy today",
      intro: clip(json.intro, 300),
      items,
      ...(json.blind ? { blind: clip(json.blind, 200) } : {}),
      source: "claude",
      writtenAt: Date.now(),
    };
  } catch (err) {
    console.error("gossip column error", err instanceof Anthropic.APIError ? `${err.status} ${err.message}` : err);
    return null;
  }
}

// Offline column, so the tab works without a key. Not cached, so a real one replaces it once a key is set.
function stub(posts: PublicPost[]): Column {
  const line = (p: PublicPost) => {
    const [x, y] = names(p);
    if (p.messages.some((m) => m.kind === "rug")) return `${x} and ${y} launched hot and ended in a rug. sources say someone is still texting into the void.`;
    if (p.messages.some((m) => m.kind === "reveal")) return `just when ${x} and ${y} were trending, a dev wallet reveal nuked the chart. we have questions.`;
    if (p.c) return `${names(p).join(", ")}: a booth built for two, seating three. nobody is admitting who invited who.`;
    return `${x} and ${y} were spotted getting very cozy over ${p.messages.length} messages. the chart says they're not just friends.`;
  };
  return {
    date: today(),
    headline: "who hooked up at the bar last night",
    intro: "the pool was busy. here's what our sources saw.",
    items: posts.map((p) => ({ postId: p.id, title: p.title, blurb: line(p) })),
    source: "stub",
    writtenAt: Date.now(),
  };
}

// Today's column, written on the first read of the day and cached. `refresh` rewrites it (admin).
export async function todaysColumn(refresh = false): Promise<Column | null> {
  const date = today();
  const cached = refresh ? null : await kvGet("gossip", date);
  let col = cached ? (JSON.parse(cached) as Column) : null;
  if (!col) {
    const posts = await sources();
    if (!posts.length) return null;
    const written = await write(posts);
    if (written) await kvSet("gossip", date, JSON.stringify(written));
    col = written ?? stub(posts);
  }
  // a post that was reported away or taken down since takes its item with it
  const live = await kvAll("feed");
  const visible = (id: string) => live[id] && !(JSON.parse(live[id]) as FeedItem).hidden;
  return { ...col, items: col.items.filter((it) => visible(it.postId)) };
}
