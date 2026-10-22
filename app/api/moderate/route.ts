import { moderateImage } from "@/lib/moderation";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const { image } = (await req.json()) as { image?: string };
  const r = await moderateImage(image);
  if ("error" in r) {
    const status = r.error === "no_key" ? 503 : r.error === "bad_image" ? 400 : 502;
    return Response.json({ reason: r.error }, { status });
  }
  return Response.json(r);
}
