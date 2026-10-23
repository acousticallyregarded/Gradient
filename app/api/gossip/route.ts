import { isAdmin } from "@/lib/claim";
import { todaysColumn } from "@/lib/gossip";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The daily gossip column, built from public feed posts. ?refresh=1 rewrites today's (admin only).
export async function GET(req: Request) {
  const refresh = new URL(req.url).searchParams.get("refresh") === "1" && isAdmin(req);
  try {
    return Response.json({ column: await todaysColumn(refresh) });
  } catch (e) {
    console.error(e);
    return Response.json({ column: null });
  }
}
