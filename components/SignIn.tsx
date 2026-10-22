"use client";

import { useEffect, useState } from "react";
import { isMobile, signIn, WALLETS, type WalletOption } from "@/lib/wallet";

// Bottom sheet: pick a wallet, approve the connect, sign one message. No transaction, no fees.
export default function SignIn({ onClose, onSignedIn }: { onClose: () => void; onSignedIn: (wallet: string) => void }) {
  const [found, setFound] = useState<WalletOption[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState("");

  // Wallet extensions inject a moment after load, so look twice.
  useEffect(() => {
    const look = () => setFound(WALLETS.filter((o) => o.get()));
    look();
    const t = setTimeout(look, 600);
    return () => clearTimeout(t);
  }, []);

  const go = async (o: WalletOption) => {
    setBusy(o.id);
    setErr("");
    try {
      onSignedIn(await signIn(o));
    } catch (e) {
      const msg = (e as Error).message || "";
      setErr(/reject|denied|cancel/i.test(msg) ? "you cancelled it in the wallet" : msg || "sign-in failed");
    } finally {
      setBusy(null);
    }
  };

  const here = typeof location !== "undefined" ? location.href : "";
  const mobile = isMobile();

  return (
    <div className="sheet-wrap" onClick={onClose}>
      <div className="sheet signin" onClick={(e) => e.stopPropagation()}>
        <h3>◎ sign in with your wallet</h3>
        <p className="muted small">
          your agents and chats save to your wallet, so they follow you to any device. you sign one message to prove
          it's you. it's not a transaction, costs nothing, and we never see your keys.
        </p>

        {found.length > 0 ? (
          <div className="wallet-list">
            {found.map((o) => (
              <button key={o.id} className="btn wide wallet-btn" disabled={!!busy} onClick={() => go(o)}>
                <span>{o.icon}</span> {busy === o.id ? "check your wallet…" : o.name}
              </button>
            ))}
          </div>
        ) : mobile ? (
          <>
            <p className="small">on a phone, open Gradient inside your wallet's browser:</p>
            <div className="wallet-list">
              {WALLETS.filter((o) => o.id !== "backpack").map((o) => (
                <a key={o.id} className="btn wide wallet-btn" href={o.browse(here)}>
                  <span>{o.icon}</span> open in {o.name}
                </a>
              ))}
            </div>
          </>
        ) : (
          <>
            <p className="small">no Solana wallet found in this browser. install one, then reload:</p>
            <div className="wallet-list">
              {WALLETS.map((o) => (
                <a key={o.id} className="btn wide wallet-btn" href={o.install} target="_blank" rel="noreferrer">
                  <span>{o.icon}</span> get {o.name}
                </a>
              ))}
            </div>
          </>
        )}

        {err && <p className="small err">{err}</p>}
        <button className="btn ghost wide" onClick={onClose}>
          not now
        </button>
      </div>
    </div>
  );
}
