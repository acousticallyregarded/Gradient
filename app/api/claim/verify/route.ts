import { claimConfigured, issueToken, normHandle, verifyTweet } from "@/lib/claim";

export const runtime = "nodejs";

export async function POST(req: Request) {
  if (!claimConfigured()) return Response.json({ error: "claims aren't set up on this server yet" }, { status: 503 });
  const { handle: raw, tweetUrl } = (await req.json()) as { handle?: string; tweetUrl?: string };
  const handle = normHandle(raw ?? "");
  if (!handle) return Response.json({ error: "that doesn't look like an X handle" }, { status: 400 });
  const r = await verifyTweet(tweetUrl ?? "", handle);
  if (!r.ok) return Response.json({ error: r.reason }, { status: 400 });
  return Response.json({ token: issueToken(handle) });
}
