import { claimConfigured, codeFor, normHandle, tweetTextFor } from "@/lib/claim";

export const runtime = "nodejs";

export async function POST(req: Request) {
  if (!claimConfigured()) return Response.json({ error: "claims aren't set up on this server yet" }, { status: 503 });
  const { handle: raw } = (await req.json()) as { handle?: string };
  const handle = normHandle(raw ?? "");
  if (!handle) return Response.json({ error: "that doesn't look like an X handle" }, { status: 400 });
  return Response.json({ handle, code: codeFor(handle), tweetText: tweetTextFor(handle) });
}
