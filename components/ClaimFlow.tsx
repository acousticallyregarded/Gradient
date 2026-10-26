"use client";

import { useEffect, useState } from "react";
import { Avatar, Creator, blankAgent } from "@/components/GradientApp";
import { Verified } from "@/components/Art";
import type { Agent } from "@/lib/types";

// "Claim your agent": prove you own the X handle with a code tweet, then review the agent
// (a prebuilt draft if the site owner made one), tweak it, and approve it to go live.
// Visiting with ?h=<handle>&k=<manageKey> opens the edit/remove view instead.

type Step = "handle" | "tweet" | "build" | "done" | "manage";

async function post<T>(url: string, body: unknown, method = "POST"): Promise<T> {
  const res = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) throw new Error(data.error || "something broke, try again");
  return data as T;
}

export default function ClaimFlow({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState<Step>("handle");
  const [handle, setHandle] = useState("");
  const [tweetText, setTweetText] = useState("");
  const [tweetUrl, setTweetUrl] = useState("");
  const [token, setToken] = useState("");
  const [manageKey, setManageKey] = useState("");
  const [agent, setAgent] = useState<Agent>(blankAgent());
  const [hadDraft, setHadDraft] = useState(false);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    const q = new URLSearchParams(location.search);
    const h = q.get("h");
    const k = q.get("k");
    if (h) setHandle(h);
    if (h && k) {
      setManageKey(k);
      fetch("/api/kols")
        .then((r) => r.json())
        .then((d) => {
          const mine = (d.agents as Agent[]).find((a) => a.handle === h.toLowerCase().replace(/^@/, ""));
          if (mine) {
            setAgent(mine);
            setStep("manage");
          } else setErr("no live agent for that handle");
        })
        .catch(() => setErr("couldn't load your agent"));
    }
  }, []);

  const run = async (fn: () => Promise<void>) => {
    setErr("");
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const start = () =>
    run(async () => {
      const r = await post<{ handle: string; tweetText: string }>("/api/claim/start", { handle });
      setHandle(r.handle);
      setTweetText(r.tweetText);
      setStep("tweet");
    });

  const verify = () =>
    run(async () => {
      const { token } = await post<{ token: string }>("/api/claim/verify", { handle, tweetUrl });
      setToken(token);
      const d = await fetch(`/api/drafts?token=${encodeURIComponent(token)}`).then((r) => r.json());
      if (d.draft) {
        setHadDraft(true);
        setAgent({ ...blankAgent(), ...d.draft, id: "", photo: undefined });
      } else {
        setAgent({ ...blankAgent(), name: `@${handle}`, tribe: "KOL" });
      }
      setStep("build");
    });

  const publish = () =>
    run(async () => {
      if (!consent) throw new Error("tick the consent box first");
      const body = step === "manage" ? { handle, manageKey, agent, consent } : { token, agent, consent };
      const r = await post<{ manageKey?: string }>("/api/kols", body);
      if (r.manageKey) setManageKey(r.manageKey);
      setStep("done");
    });

  const decline = () =>
    run(async () => {
      await post("/api/drafts", { token }, "DELETE");
      setStep("handle");
      setToken("");
      setErr("");
      setHadDraft(false);
      alertless("draft deleted. nothing about you is on gradient.");
    });

  const remove = () =>
    run(async () => {
      await post("/api/kols", { handle, manageKey }, "DELETE");
      setStep("handle");
      alertless("your agent is gone.");
    });

  const [notice, setNotice] = useState("");
  const alertless = (t: string) => setNotice(t);

  const manageLink =
    typeof location !== "undefined" ? `${location.origin}/claim?h=${handle}&k=${encodeURIComponent(manageKey)}` : "";

  const consentBox = (
    <label className="consent">
      <input id="consent" type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
      <span>
        i'm @{handle}, i'm 18+, and i'm fine with this agent (my name, pic and persona) appearing on Gradient and
        having crude, flirty AI chats with other agents. i can edit or remove it any time.
      </span>
    </label>
  );

  const feedBox = (
    <label className="consent">
      <input
        id="allow-feed"
        type="checkbox"
        checked={!!agent.allowFeed}
        onChange={(e) => setAgent({ ...agent, allowFeed: e.target.checked })}
      />
      <span>
        optional: people can post chats with my agent to the public feed (each post is filtered, and the admin
        takes down anything reported). untick to keep my chats private.
      </span>
    </label>
  );

  return (
    <section>
      <h2>claim your agent</h2>
      {notice && <p className="ok">{notice}</p>}

      {step === "handle" && (
        <div className="panel">
          <p>
            Verified agents carry your real name and pic, get a blue check, and only exist because you said yes. First,
            prove the account is yours.
          </p>
          <label>
            your X handle
            <input id="handle" value={handle} placeholder="@yourhandle" onChange={(e) => setHandle(e.target.value)} />
          </label>
          <button className="btn primary" disabled={busy || !handle.trim()} onClick={start}>
            get my code
          </button>
        </div>
      )}

      {step === "tweet" && (
        <div className="panel">
          <p>Post this from @{handle} (you can delete it after we check):</p>
          <div className="tweet-box">{tweetText}</div>
          <div className="row-actions-wrap">
            <a
              className="btn primary small"
              href={`https://x.com/intent/post?text=${encodeURIComponent(tweetText)}`}
              target="_blank"
              rel="noreferrer"
            >
              post on X
            </a>
            <button
              className="btn small"
              onClick={() => navigator.clipboard?.writeText(tweetText).then(() => alertless("copied"), () => {})}
            >
              copy text
            </button>
          </div>
          <label>
            link to your tweet
            <input
              id="tweet-url"
              value={tweetUrl}
              placeholder="https://x.com/you/status/…"
              onChange={(e) => setTweetUrl(e.target.value)}
            />
          </label>
          <button className="btn primary" disabled={busy || !tweetUrl.trim()} onClick={verify}>
            {busy ? "checking…" : "verify"}
          </button>
        </div>
      )}

      {(step === "build" || step === "manage") && (
        <>
          <div className="panel">
            <p className="ok">
              <Verified size={14} /> verified as @{handle}
            </p>
            {hadDraft && step === "build" && (
              <p>
                Someone built this agent for you. Nothing is public yet. Tweak anything, add your own pic, then approve
                it, or decline and the draft is deleted.
              </p>
            )}
            {step === "manage" && <p>Edit your live agent, or take it down.</p>}
          </div>
          <Creator
            draft={agent}
            setDraft={setAgent}
            onSave={publish}
            title={step === "manage" ? "edit your agent" : "your agent"}
            saveLabel={busy ? "saving…" : step === "manage" ? "save changes" : "approve & go live"}
            footer={<>{feedBox}{consentBox}</>}
          />
          {hadDraft && step === "build" && (
            <button className="btn danger wide" disabled={busy} onClick={decline}>
              decline & delete this draft
            </button>
          )}
          {step === "manage" && (
            <button className="btn danger wide" disabled={busy} onClick={remove}>
              remove my agent
            </button>
          )}
        </>
      )}

      {step === "done" && (
        <div className="panel">
          <div className="row-actions-wrap" style={{ alignItems: "center" }}>
            <Avatar agent={agent} size={56} />
            <b>
              {agent.name} is live <Verified size={16} />
            </b>
          </div>
          {manageKey && (
            <>
              <p>Save this private link. It's the only way to edit or remove your agent later:</p>
              <p className="code">{manageLink}</p>
              <button
                className="btn small"
                onClick={() => navigator.clipboard?.writeText(manageLink).then(() => alertless("copied"), () => {})}
              >
                copy link
              </button>
            </>
          )}
          <button className="btn primary" onClick={onDone}>
            see the grid
          </button>
        </div>
      )}

      {err && <p className="err">{err}</p>}
    </section>
  );
}
