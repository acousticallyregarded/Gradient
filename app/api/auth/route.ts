import { authConfigured, checkSignIn, clearCookie, newNonce, requestHost, sessionCookie, sessionWallet } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Who's signed in, plus a fresh nonce to sign if nobody is.
export async function GET(req: Request) {
  if (!authConfigured()) return Response.json({ enabled: false, wallet: null });
  const wallet = sessionWallet(req);
  return Response.json({ enabled: true, wallet, nonce: wallet ? undefined : newNonce(), host: requestHost(req) });
}

export async function POST(req: Request) {
  if (!authConfigured()) return Response.json({ error: "wallet sign-in isn't set up on this server" }, { status: 503 });
  const body = (await req.json().catch(() => ({}))) as { wallet?: string; nonce?: string; signature?: string };
  const err = await checkSignIn(requestHost(req), String(body.wallet ?? ""), String(body.nonce ?? ""), String(body.signature ?? ""));
  if (err) return Response.json({ error: err }, { status: 401 });
  return Response.json({ wallet: body.wallet }, { headers: { "set-cookie": sessionCookie(body.wallet!) } });
}

export async function DELETE() {
  return Response.json({ ok: true }, { headers: { "set-cookie": clearCookie() } });
}
