// Browser side of "sign in with a Solana wallet". Uses the wallets' injected providers directly
// (Phantom, Solflare, Backpack all expose connect() + signMessage()), so no wallet SDK is bundled.
import type { Agent, Match } from "./types";

interface Provider {
  connect: () => Promise<{ publicKey?: { toString(): string } } | void>;
  disconnect?: () => Promise<void>;
  signMessage: (msg: Uint8Array, enc?: string) => Promise<{ signature: Uint8Array } | Uint8Array>;
  publicKey?: { toString(): string } | null;
  isPhantom?: boolean;
}

export interface WalletOption {
  id: string;
  name: string;
  icon: string;
  get: () => Provider | undefined;
  install: string;
  // opens this site inside the wallet's own browser (how wallets work on phones)
  browse: (url: string) => string;
}

type W = Window & {
  phantom?: { solana?: Provider };
  solflare?: Provider & { isSolflare?: boolean };
  backpack?: Provider;
  solana?: Provider;
};
const w = () => (typeof window !== "undefined" ? (window as W) : undefined);

export const WALLETS: WalletOption[] = [
  {
    id: "phantom",
    name: "Phantom",
    icon: "👻",
    get: () => w()?.phantom?.solana ?? (w()?.solana?.isPhantom ? w()?.solana : undefined),
    install: "https://phantom.com/download",
    browse: (u) => `https://phantom.app/ul/browse/${encodeURIComponent(u)}?ref=${encodeURIComponent(u)}`,
  },
  {
    id: "solflare",
    name: "Solflare",
    icon: "🔥",
    get: () => w()?.solflare,
    install: "https://solflare.com/download",
    browse: (u) => `https://solflare.com/ul/v1/browse/${encodeURIComponent(u)}?ref=${encodeURIComponent(u)}`,
  },
  {
    id: "backpack",
    name: "Backpack",
    icon: "🎒",
    get: () => w()?.backpack,
    install: "https://backpack.app/downloads",
    browse: (u) => u,
  },
];

export const isMobile = () => typeof navigator !== "undefined" && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

export const shortWallet = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;

// Must match lib/auth.ts signInMessage exactly.
const signInMessage = (host: string, wallet: string, nonce: string) =>
  `${host} wants you to sign in to Gradient with your Solana account:\n${wallet}\n\n` +
  `This only proves you own this wallet. It is not a transaction and costs nothing.\n\nNonce: ${nonce}`;

export interface AuthState {
  enabled: boolean;
  wallet: string | null;
}

export async function authStatus(): Promise<AuthState> {
  try {
    const r = await fetch("/api/auth", { cache: "no-store" });
    const d = await r.json();
    return { enabled: !!d.enabled, wallet: d.wallet ?? null };
  } catch {
    return { enabled: false, wallet: null };
  }
}

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

export async function signIn(opt: WalletOption): Promise<string> {
  const p = opt.get();
  if (!p) throw new Error(`${opt.name} not found`);
  const res = await p.connect();
  const pk = (res && "publicKey" in res && res.publicKey) || p.publicKey;
  if (!pk) throw new Error("wallet didn't share an address");
  const wallet = pk.toString();
  const s = await (await fetch("/api/auth", { cache: "no-store" })).json();
  if (!s.enabled) throw new Error("wallet sign-in isn't set up on this server");
  const msg = new TextEncoder().encode(signInMessage(s.host, wallet, s.nonce));
  const signed = await p.signMessage(msg, "utf8");
  const signature = signed instanceof Uint8Array ? signed : signed.signature;
  const r = await fetch("/api/auth", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ wallet, nonce: s.nonce, signature: b64(signature) }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || "sign-in failed");
  return wallet;
}

export async function signOut() {
  await fetch("/api/auth", { method: "DELETE" }).catch(() => {});
  for (const o of WALLETS) await o.get()?.disconnect?.().catch(() => {});
}

export async function loadCloud(): Promise<{ agents: Agent[]; matches: Match[] } | null> {
  try {
    const r = await fetch("/api/me", { cache: "no-store" });
    if (!r.ok) return null;
    const d = await r.json();
    return { agents: d.agents ?? [], matches: d.matches ?? [] };
  } catch {
    return null;
  }
}

export async function saveCloud(agents: Agent[], matches: Match[]) {
  try {
    const r = await fetch("/api/me", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agents, matches: matches.slice(0, 30) }),
    });
    return r.ok;
  } catch {
    return false;
  }
}

// Merging what was on this device with what's saved to the wallet: union by id, and for a chat
// that exists in both, keep whichever got further.
export function mergeById<T extends { id: string }>(cloud: T[], local: T[], better: (a: T, b: T) => T = (a) => a): T[] {
  const out = new Map<string, T>();
  for (const x of cloud) out.set(x.id, x);
  for (const x of local) out.set(x.id, out.has(x.id) ? better(out.get(x.id)!, x) : x);
  return [...out.values()];
}

export const longerChat = (a: Match, b: Match) => (b.messages.length > a.messages.length ? b : a);
