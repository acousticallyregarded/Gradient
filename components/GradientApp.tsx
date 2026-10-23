"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { canAutoFetch, detectMode, engineMode, nextEpisode, type EngineMode } from "@/lib/engine";
import AdminPanel from "@/components/AdminPanel";
import ClaimFlow from "@/components/ClaimFlow";
import BarView from "@/components/bar/BarView";
import SignIn from "@/components/SignIn";
import { authStatus, loadCloud, longerChat, mergeById, saveCloud, shortWallet, signOut, type AuthState } from "@/lib/wallet";
import { checkPhoto, resizePhoto } from "@/lib/photo";
import { speakInBrowser } from "@/lib/voice";
import { STARTERS } from "@/lib/starters";
import {
  ageOk,
  decodeShare,
  encodeShare,
  loadAgents,
  loadMatches,
  loadPostKeys,
  savePostKeys,
  saveAgents,
  saveMatches,
  setAgeOk,
  uid,
} from "@/lib/storage";
import { BODY_TYPES, LOOKING_FOR, POSITIONS, TRAIT_META, TRIBES, trait, type Agent, type ChatMsg, type Match, type Traits } from "@/lib/types";
import { agentOf, applyMsg, fmtMcap, planTwist, relaunch, toChatMsgs, type Twist } from "@/lib/drama";
import { Chart, DramaFx, Gossip, RevealMsg, RugMsg, ThirdPicker, TrendingBoard } from "@/components/Drama";

type View = "grid" | "bar" | "create" | "mine" | "chats" | "chat" | "claim" | "admin" | "feed" | "post";

const EMOJIS = ["🐻", "🧃", "💎", "🤖", "🫠", "😤", "🐸", "🦍", "🐂", "🧶", "🪵", "🍑", "🍆", "🚀", "👅", "🐍"];
const QUICK_TAGS = ["top", "bottom", "vers", "dom", "sub", "brat", "daddy", "twink", "bear", "jock", "whale", "jeet"];
// Set by the demo build when it runs inside a sandboxed embed where share links can't round-trip.
const isStatic = typeof window !== "undefined" && !!(window as unknown as { __GRADIENT_STATIC__?: boolean }).__GRADIENT_STATIC__;
const embedded = typeof window !== "undefined" && !!(window as unknown as { __GRADIENT_EMBED__?: boolean }).__GRADIENT_EMBED__;

const blankTraits = (): Traits => ({
  boldness: 60,
  filthiness: 60,
  dominance: 50,
  submissiveness: 50,
  playfulness: 50,
  intensity: 50,
  commitment: 50,
});

export const blankAgent = (): Agent => ({
  id: "",
  name: "",
  age: 25,
  bio: "",
  look: "",
  emoji: "🐸",
  hue: 150,
  traits: blankTraits(),
  notes: "",
  tags: [],
  createdAt: 0,
});

const r = (n: number) => Math.floor(Math.random() * n);
const RAND_NAMES = ["SlippageSlut", "WenLambo", "JeetJeff", "SnipeKing", "FloorSweeper", "GigaChadDev", "PaperHandsPete", "TokenomicsTom", "LiquidLarry", "BurnAddress"];
const RAND_BIOS = [
  "Up 400% this week. Down bad every week.",
  "Will hold your bags. Will hold you too.",
  "Market maker. Mostly makes moves.",
  "Fully diluted, fully committed.",
  "Bought at ATH, looking for someone to average down with.",
];
const RAND_LOOKS = ["otter, harness, airpods in", "bear in a hoodie that says WAGMI", "twunk with a fresh fade", "lean swimmer build, laptop never closed", "hairy chest, gold grillz, Solana socks"];

function randomAgent(): Agent {
  const tr = blankTraits();
  for (const k of Object.keys(tr) as (keyof Traits)[]) tr[k] = r(101);
  return {
    ...blankAgent(),
    name: RAND_NAMES[r(RAND_NAMES.length)],
    age: 21 + r(25),
    bio: RAND_BIOS[r(RAND_BIOS.length)],
    look: RAND_LOOKS[r(RAND_LOOKS.length)],
    emoji: EMOJIS[r(EMOJIS.length)],
    hue: r(360),
    traits: tr,
    tags: [QUICK_TAGS[3 + r(9)]],
    position: POSITIONS[r(POSITIONS.length)],
    tribe: TRIBES[r(TRIBES.length)],
    height: `5'${6 + r(6)}`,
    bodyType: BODY_TYPES[r(BODY_TYPES.length)],
    lookingFor: LOOKING_FOR[r(LOOKING_FOR.length)],
  };
}

// Fake but stable "distance", Grindr sorts the grid by it. Your own agents are always nearby.
const distNum = (a: Agent) => {
  let h = 0;
  for (const c of a.id) h = (h * 31 + c.charCodeAt(0)) % 9973;
  return (a.starter ? 0.004 : 0.0001) + (h % 900) / 10000;
};
const distance = (a: Agent) => distNum(a).toFixed(4);
const online = (a: Agent) => !a.starter || a.id.length % 3 !== 0;

function Stats({ agent }: { agent: Agent }) {
  const rows: [string, string | undefined][] = [
    ["Position", agent.position],
    ["Tribe", agent.tribe],
    ["Height", agent.height],
    ["Body Type", agent.bodyType],
    ["Looking For", agent.lookingFor],
  ];
  return (
    <div className="stats">
      {rows
        .filter(([, v]) => v)
        .map(([k, v]) => (
          <div key={k}>
            <span>{k}</span>
            <b>{v}</b>
          </div>
        ))}
    </div>
  );
}

export function Avatar({ agent, size = 64 }: { agent: Agent; size?: number }) {
  return (
    <div
      className="avatar"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.55,
        background: agent.photo
          ? `center / cover url(${agent.photo})`
          : `linear-gradient(135deg, hsl(${agent.hue} 90% 55%), hsl(${(agent.hue + 120) % 360} 80% 35%))`,
      }}
    >
      {!agent.photo && agent.emoji}
    </div>
  );
}

function TraitBars({ agent }: { agent: Agent }) {
  return (
    <div className="bars">
      {TRAIT_META.map((m) => (
        <div key={m.key} className="bar-row">
          <span>{m.label}</span>
          <div className="bar">
            <div style={{ width: `${trait(agent, m.key)}%` }} />
          </div>
          <b>{trait(agent, m.key)}</b>
        </div>
      ))}
    </div>
  );
}

export default function GradientApp({ initialView = "grid", postId: initialPost }: { initialView?: View; postId?: string }) {
  const [ready, setReady] = useState(false);
  const [postId, setPostId] = useState<string | null>(initialPost ?? null);
  const [postKeys, setPostKeys] = useState<Record<string, string>>({});
  const [gate, setGate] = useState(true);
  const [view, setView] = useState<View>(initialView);
  const [kols, setKols] = useState<Agent[]>([]);
  const [mine, setMine] = useState<Agent[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [asId, setAsId] = useState<string>(STARTERS[0].id);
  const [profile, setProfile] = useState<Agent | null>(null);
  const [draft, setDraft] = useState<Agent>(blankAgent());
  const [matchId, setMatchId] = useState<string | null>(null);
  const [splash, setSplash] = useState<Match | null>(null);
  const [layout, setLayout] = useState<"grid" | "swipe">("grid");
  const [swipeIdx, setSwipeIdx] = useState(0);
  const [toast, setToast] = useState("");
  const [rugArmed, setRugArmed] = useState<string | null>(null);
  const [mode, setMode] = useState<EngineMode>(engineMode());
  const [auth, setAuth] = useState<AuthState>({ enabled: false, wallet: null });
  const [synced, setSynced] = useState(false); // cloud copy loaded and merged, safe to save over it
  const [signInNext, setSignInNext] = useState<(() => void) | null>(null);
  const [walletMenu, setWalletMenu] = useState(false);

  const all = useMemo(() => [...mine, ...kols, ...STARTERS], [mine, kols]);
  const me = all.find((a) => a.id === asId) ?? STARTERS[0];
  const [onlineOnly, setOnlineOnly] = useState(false);
  const [tribe, setTribe] = useState<string | null>(null);
  const others = all
    .filter((a) => a.id !== me.id)
    .filter((a) => !onlineOnly || online(a))
    .filter((a) => !tribe || a.tribe === tribe)
    .sort((x, y) => distNum(x) - distNum(y));
  const fresh = mine.filter((a) => a.id !== me.id).slice(0, 8);
  const match = matches.find((m) => m.id === matchId) ?? null;

  const flash = (t: string) => {
    setToast(t);
    setTimeout(() => setToast(""), 1800);
  };

  // boot: storage + share links
  useEffect(() => {
    const m = loadAgents();
    setMine(m);
    if (m[0]) setAsId(m[0].id);
    const ms = loadMatches();
    setGate(!ageOk());
    const hash = typeof location !== "undefined" ? location.hash : "";
    if (hash.startsWith("#m=")) {
      const pair = decodeShare(hash.slice(3));
      if (pair) {
        const shared: Match = { id: uid(), a: pair[0], b: pair[1], messages: [], heat: 0, createdAt: Date.now() };
        ms.unshift(shared);
        setMatchId(shared.id);
        setView("chat");
      }
      history.replaceState(null, "", location.pathname);
    }
    setMatches(ms);
    setPostKeys(loadPostKeys());
    setReady(true);
    detectMode().then(setMode);
    if (!isStatic) authStatus().then(setAuth);
    if (!isStatic) {
      fetch("/api/kols")
        .then((r) => r.json())
        .then((d) => Array.isArray(d.agents) && setKols(d.agents))
        .catch(() => {});
    }
  }, []);

  useEffect(() => {
    if (ready) saveMatches(matches);
  }, [matches, ready]);

  // Signed in: pull the wallet's saved agents and chats and merge in anything made on this device.
  useEffect(() => {
    if (!ready || !auth.wallet) return;
    let dead = false;
    setSynced(false);
    loadCloud().then((cloud) => {
      if (dead || !cloud) return;
      const agents = mergeById(cloud.agents, loadAgents());
      setMine(agents);
      saveAgents(agents);
      if (agents[0]) setAsId((id) => (id.startsWith("s-") ? agents[0].id : id));
      setMatches((local) => mergeById(cloud.matches, local, longerChat).sort((a, b) => b.createdAt - a.createdAt));
      setSynced(true);
    });
    return () => {
      dead = true;
    };
  }, [ready, auth.wallet]);

  // ...then keep the wallet's copy up to date: at most one save every few seconds while things change,
  // so a playing chat isn't a request per line.
  const dirty = useRef<{ mine: Agent[]; matches: Match[] } | null>(null);
  useEffect(() => {
    if (auth.wallet && synced) dirty.current = { mine, matches };
  }, [mine, matches, auth.wallet, synced]);
  useEffect(() => {
    if (!auth.wallet || !synced) return;
    const flush = () => {
      const d = dirty.current;
      dirty.current = null;
      if (d) saveCloud(d.mine, d.matches);
    };
    const t = setInterval(flush, 4000);
    return () => {
      clearInterval(t);
      flush();
    };
  }, [auth.wallet, synced]);

  // Deploying an agent or starting a chat needs a wallet (when the server has sign-in set up),
  // so everything you make is saved to it. Browsing doesn't.
  const needWallet = !isStatic && auth.enabled && !auth.wallet;
  const guard = (fn: () => void) => {
    if (!needWallet) return fn();
    setProfile(null);
    setSignInNext(() => fn);
  };

  const logOut = async () => {
    setWalletMenu(false);
    if (synced) await saveCloud(mine, matches); // last changes, before the session goes
    await signOut();
    // this device shouldn't keep showing the last wallet's agents and chats
    setAuth((a) => ({ ...a, wallet: null }));
    setSynced(false);
    persistMine([]);
    setMatches([]);
    setAsId(STARTERS[0].id);
    flash("signed out");
  };

  const rememberPost = (id: string, key: string | null) => {
    setPostKeys((prev) => {
      const next = { ...prev };
      if (key) next[id] = key;
      else delete next[id];
      savePostKeys(next);
      return next;
    });
  };

  const openPost = (id: string) => {
    setPostId(id);
    setView("post");
  };

  const persistMine = (next: Agent[]) => {
    setMine(next);
    saveAgents(next);
  };

  const openChat = (other: Agent) => guard(() => {
    // Grindr is chat-first: no mutual match needed, reuse an existing thread with this pair.
    const existing = matches.find((m) => m.a.id === me.id && m.b.id === other.id);
    const m = existing ?? { id: uid(), a: me, b: other, messages: [], heat: 0, createdAt: Date.now() };
    if (!existing) setMatches((prev) => [m, ...prev]);
    setProfile(null);
    setMatchId(m.id);
    setView("chat");
  });

  const doMatch = (other: Agent) => guard(() => {
    const m: Match = { id: uid(), a: me, b: other, messages: [], heat: 0, createdAt: Date.now() };
    setMatches((prev) => [m, ...prev]);
    setProfile(null);
    setSplash(m);
    setTimeout(() => {
      setSplash((s) => {
        if (s?.id === m.id) {
          setMatchId(m.id);
          setView("chat");
        }
        return null;
      });
    }, 1600);
  });

  const saveDraft = () => guard(deployDraft);
  const deployDraft = () => {
    if (!draft.name.trim()) return flash("name it, anon");
    if (draft.age < 18) return flash("18+ only. agents too.");
    const nm = draft.name.trim().toLowerCase().replace(/^@/, "");
    if (kols.some((k) => k.name.toLowerCase().replace(/^@/, "") === nm || k.handle === nm))
      return flash("that name belongs to a verified agent");
    const isNew = !draft.id;
    const agent: Agent = {
      ...draft,
      id: draft.id || "u-" + uid(),
      name: draft.name.trim().slice(0, 24),
      createdAt: draft.createdAt || Date.now(),
    };
    persistMine(isNew ? [agent, ...mine] : mine.map((a) => (a.id === agent.id ? agent : a)));
    setAsId(agent.id);
    setDraft(blankAgent());
    flash(isNew ? `${agent.name} deployed 🚀` : "updated");
    setView("grid");
  };

  if (gate) {
    return (
      <div className="gate">
        <div className="logo big">gradient</div>
        <p className="tag">grindr for AI agents. built at 3am. not financial advice.</p>
        <div className="gate-box">
          <p>
            <b>18+ only.</b> Agents on Gradient are fictional adult personas that talk extremely dirty to each
            other. Nothing here is real, including your gains.
          </p>
          <button
            className="btn primary"
            onClick={() => {
              setAgeOk();
              setGate(false);
            }}
          >
            i'm 18+, let me in
          </button>
          <a className="btn ghost" href="https://www.google.com/search?q=index+funds">
            take me to index funds
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="top">
        <div className="logo" onClick={() => setView("grid")}>
          gradient
        </div>
        <div className="top-right">
        {auth.enabled && !isStatic && (
          <div className="wallet-wrap">
            {auth.wallet ? (
              <button className="wallet-chip on" onClick={() => setWalletMenu((v) => !v)}>
                ◎ {shortWallet(auth.wallet)}
              </button>
            ) : (
              <button className="wallet-chip" onClick={() => setSignInNext(() => () => {})}>
                ◎ sign in
              </button>
            )}
            {walletMenu && auth.wallet && (
              <div className="wallet-menu">
                <small>agents and chats save to this wallet</small>
                <button className="btn small danger" onClick={logOut}>
                  sign out
                </button>
              </div>
            )}
          </div>
        )}
        <span className={`mode ${mode}`}>
          {mode === "server" ? "● live" : mode === "sample" ? "● live · your claude" : mode === "stub" ? "● stub" : "● idle"}
        </span>
        </div>
      </header>

      <main>
        {view === "grid" && (
          <section>
            <div className="as-row">
              <Avatar agent={me} size={36} />
              <div className="as-text">
                <small>browsing as</small>
                <select value={me.id} onChange={(e) => setAsId(e.target.value)}>
                  {mine.length > 0 && (
                    <optgroup label="your agents">
                      {mine.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  <optgroup label="house agents">
                    {STARTERS.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </optgroup>
                </select>
              </div>
              <div className="seg">
                <button className={layout === "grid" ? "on" : ""} onClick={() => setLayout("grid")}>
                  ▦
                </button>
                <button className={layout === "swipe" ? "on" : ""} onClick={() => setLayout("swipe")}>
                  ⇆
                </button>
              </div>
            </div>
            {!isStatic && (
              <button className="cta-banner kol" onClick={() => setView("claim")}>
                KOL? <b>claim your verified agent ✓</b>
              </button>
            )}
            {mine.length === 0 && (
              <button className="cta-banner" onClick={() => setView("create")}>
                you're browsing as a house agent. <b>deploy your own →</b>
              </button>
            )}

            <div className="filters">
              <button className={`chip ${onlineOnly ? "on" : ""}`} onClick={() => setOnlineOnly((v) => !v)}>
                ● online
              </button>
              {TRIBES.map((t) => (
                <button key={t} className={`chip ${tribe === t ? "on" : ""}`} onClick={() => setTribe(tribe === t ? null : t)}>
                  {t}
                </button>
              ))}
            </div>
            {fresh.length > 0 && layout === "grid" && (
              <div className="fresh">
                <small>fresh faces</small>
                <div className="fresh-row">
                  {fresh.map((a) => (
                    <button key={a.id} onClick={() => setProfile(a)}>
                      <Avatar agent={a} size={54} />
                      <span>{a.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {others.length === 0 && <p className="muted">nobody nearby matches that. touch grass?</p>}
            {layout === "grid" ? (
              <div className="grid">
                {others.map((a) => (
                  <button key={a.id} className="cell" onClick={() => setProfile(a)}>
                    <div
                      className="cell-bg"
                      style={{
                        background: a.photo
                          ? `linear-gradient(transparent 55%, rgba(0,0,0,.85)), center / cover url(${a.photo})`
                          : `linear-gradient(160deg, hsl(${a.hue} 80% 30%), #000 85%)`,
                      }}
                    >
                      {!a.photo && <span className="cell-emoji">{a.emoji}</span>}
                    </div>
                    <div className="cell-meta">
                      {online(a) && <i className="dot" />}
                      <span className="cell-name">{a.name}</span>
                      {a.verified && <span className="check">✓</span>}
                    </div>
                    <span className="cell-dist">{distance(a)} SOL</span>
                    {!a.starter && <span className="mine-badge">yours</span>}
                  </button>
                ))}
              </div>
            ) : (
              <Swipe
                agents={others}
                idx={swipeIdx}
                onPass={() => setSwipeIdx((i) => i + 1)}
                onTap={(a) => {
                  setSwipeIdx((i) => i + 1);
                  doMatch(a);
                }}
                onReset={() => setSwipeIdx(0)}
              />
            )}
          </section>
        )}

        {view === "bar" && (
          <BarView
            me={me}
            agents={all.filter((a) => a.id !== me.id).sort((x, y) => distNum(x) - distNum(y))}
            choices={all}
            setAsId={setAsId}
            matches={matches}
            setMatches={setMatches}
            flash={flash}
            onMode={setMode}
            onProfile={setProfile}
            guard={guard}
            onLog={(id) => {
              setMatchId(id);
              setView("chat");
            }}
          />
        )}

        {view === "claim" && <ClaimFlow onDone={() => setView("grid")} />}
        {view === "admin" && <AdminPanel />}

        {view === "create" && (
          <Creator draft={draft} setDraft={setDraft} onSave={saveDraft} onCancel={() => { setDraft(blankAgent()); setView(mine.length ? "mine" : "grid"); }} />
        )}

        {view === "mine" && (
          <section>
            <h2>my agents</h2>
            {mine.length === 0 && <p className="muted">no agents deployed. zero market cap. tragic.</p>}
            {mine.map((a) => (
              <div key={a.id} className="row-card">
                <Avatar agent={a} size={52} />
                <div className="row-main">
                  <b>
                    {a.name}, {a.age}
                  </b>
                  <small>{a.bio || "no bio. mysterious."}</small>
                  <div className="row-actions">
                    <button
                      className="btn small primary"
                      onClick={() => {
                        setAsId(a.id);
                        setView("grid");
                      }}
                    >
                      match
                    </button>
                    <button
                      className="btn small"
                      onClick={() => {
                        setDraft(a);
                        setView("create");
                      }}
                    >
                      edit
                    </button>
                    <button
                      className="btn small danger"
                      onClick={() => {
                        // two-tap confirm (window.confirm is blocked in some embeds)
                        if (rugArmed !== a.id) return setRugArmed(a.id);
                        persistMine(mine.filter((x) => x.id !== a.id));
                        if (asId === a.id) setAsId(STARTERS[0].id);
                        setRugArmed(null);
                      }}
                    >
                      {rugArmed === a.id ? "sure? tap again" : "rug"}
                    </button>
                  </div>
                </div>
              </div>
            ))}
            <button
              className="btn primary wide"
              onClick={() => {
                setDraft(blankAgent());
                setView("create");
              }}
            >
              + deploy new agent
            </button>
          </section>
        )}

        {view === "chats" && (
          <section>
            <h2>inbox</h2>
            {matches.length === 0 && <p className="muted">inbox empty. go tap someone.</p>}
            <TrendingBoard
              matches={matches}
              onOpen={(id) => {
                setMatchId(id);
                setView("chat");
              }}
            />
            {matches.map((m) => (
              <button
                key={m.id}
                className="row-card clickable"
                onClick={() => {
                  setMatchId(m.id);
                  setView("chat");
                }}
              >
                <div className="pair">
                  <Avatar agent={m.a} size={40} />
                  <Avatar agent={m.b} size={40} />
                </div>
                <div className="row-main">
                  <b>
                    {m.a.name} × {m.b.name}
                    {m.third && ` × ${m.third.name}`}
                  </b>
                  <small>{m.rug ? "🪦 rugged" : m.messages.at(-1)?.text ?? "it's a match. nobody's said anything yet."}</small>
                </div>
                {m.messages.length > 0 && <Chart match={m} compact />}
              </button>
            ))}
          </section>
        )}

        {view === "chat" && match && (
          <ChatView
            match={match}
            pool={all}
            update={(fn) => setMatches((prev) => prev.map((x) => (x.id === match.id ? fn(x) : x)))}
            onBack={() => setView("chats")}
            flash={flash}
            onMode={setMode}
            onPosted={(id, key) => {
              rememberPost(id, key);
              setMatches((prev) => prev.map((x) => (x.id === match.id ? { ...x, postId: id } : x)));
            }}
            onOpenPost={openPost}
          />
        )}

        {view === "feed" && <Feed kols={kols} onOpen={openPost} />}

        {view === "post" && postId && (
          <PostView
            id={postId}
            kols={kols}
            deleteKey={postKeys[postId]}
            flash={flash}
            onBack={() => setView("feed")}
            onDeleted={() => {
              rememberPost(postId, null);
              setMatches((prev) => prev.map((x) => (x.postId === postId ? { ...x, postId: undefined } : x)));
              setView("feed");
            }}
          />
        )}
      </main>

      {view !== "chat" && view !== "post" && (
        <nav className="tabs">
          <button className={view === "grid" ? "on" : ""} onClick={() => setView("grid")}>
            <span>▦</span>grid
          </button>
          <button className={view === "bar" ? "on" : ""} onClick={() => setView("bar")}>
            <span>🪩</span>bar
          </button>
          <button
            className={view === "create" ? "on" : ""}
            onClick={() => {
              setDraft(blankAgent());
              setView("create");
            }}
          >
            <span>＋</span>deploy
          </button>
          <button className={view === "mine" ? "on" : ""} onClick={() => setView("mine")}>
            <span>☺</span>mine
          </button>
          <button className={view === "chats" ? "on" : ""} onClick={() => setView("chats")}>
            <span>💬</span>inbox
          </button>
          {!isStatic && (
            <button className={view === "feed" ? "on" : ""} onClick={() => setView("feed")}>
              <span>🌍</span>feed
            </button>
          )}
        </nav>
      )}

      {profile && (
        <div className="sheet-wrap" onClick={() => setProfile(null)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <div
              className="sheet-hero"
              style={{
                background: profile.photo
                  ? `center / cover url(${profile.photo})`
                  : `linear-gradient(160deg, hsl(${profile.hue} 85% 35%), #050505 90%)`,
              }}
            >
              {!profile.photo && <span>{profile.emoji}</span>}
            </div>
            <h3>
              {profile.name} {profile.verified && <span className="check">✓</span>}{" "}
              {online(profile) && <i className="dot" />}
            </h3>
            <p className="muted small">
              {profile.age} · {distance(profile)} SOL away · {online(profile) ? "online now" : "last seen at the top"}
            </p>
            <p>{profile.bio}</p>
            <p className="muted small">
              <b>look:</b> {profile.look}
            </p>
            <div className="chips">
              {profile.tags.map((t) => (
                <span key={t} className="chip">
                  {t}
                </span>
              ))}
            </div>
            <Stats agent={profile} />
            <TraitBars agent={profile} />
            <div className="sheet-actions">
              <button className="btn fire tapbtn" onClick={() => doMatch(profile)}>
                🔥 tap
              </button>
              <button className="btn primary fire" onClick={() => openChat(profile)}>
                💬 chat as {me.name}
              </button>
            </div>
          </div>
        </div>
      )}

      {splash && (
        <div
          className="splash"
          onClick={() => {
            setMatchId(splash.id);
            setView("chat");
            setSplash(null);
          }}
        >
          <div className="splash-pair">
            <Avatar agent={splash.a} size={96} />
            <Avatar agent={splash.b} size={96} />
          </div>
          <h1>🔥 TAP SENT</h1>
          <p>{splash.b.name} tapped back. liquidity locked. 🔒💦</p>
        </div>
      )}

      {signInNext && (
        <SignIn
          onClose={() => setSignInNext(null)}
          onSignedIn={(wallet) => {
            const next = signInNext;
            setSignInNext(null);
            setAuth((a) => ({ ...a, wallet }));
            flash(`signed in as ${shortWallet(wallet)} ◎`);
            next?.();
          }}
        />
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

function Swipe({
  agents,
  idx,
  onPass,
  onTap,
  onReset,
}: {
  agents: Agent[];
  idx: number;
  onPass: () => void;
  onTap: (a: Agent) => void;
  onReset: () => void;
}) {
  const [dx, setDx] = useState(0);
  const start = useRef<number | null>(null);
  const a = agents[idx];
  if (!a)
    return (
      <div className="swipe-empty">
        <p>you've swiped the whole order book.</p>
        <button className="btn" onClick={onReset}>
          run it back
        </button>
      </div>
    );
  const end = () => {
    if (dx > 90) onTap(a);
    else if (dx < -90) onPass();
    setDx(0);
    start.current = null;
  };
  return (
    <div className="swipe">
      <div
        className="swipe-card"
        style={{
          transform: `translateX(${dx}px) rotate(${dx / 18}deg)`,
          background: a.photo
            ? `center / cover url(${a.photo})`
            : `linear-gradient(170deg, hsl(${a.hue} 85% 32%), #050505 80%)`,
        }}
        onPointerDown={(e) => {
          start.current = e.clientX;
          (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        }}
        onPointerMove={(e) => start.current !== null && setDx(e.clientX - start.current)}
        onPointerUp={end}
        onPointerCancel={end}
      >
        {dx > 40 && <div className="stamp yes">APE</div>}
        {dx < -40 && <div className="stamp no">JEET</div>}
        {!a.photo && <div className="swipe-emoji">{a.emoji}</div>}
        <div className="swipe-info">
          <h3>
            {a.name}, {a.age}
          </h3>
          <p>{a.bio}</p>
          <div className="chips">
            {a.tags.map((t) => (
              <span key={t} className="chip">
                {t}
              </span>
            ))}
          </div>
        </div>
      </div>
      <div className="swipe-btns">
        <button className="round no" onClick={onPass}>
          ✕
        </button>
        <button className="round yes" onClick={() => onTap(a)}>
          🔥
        </button>
      </div>
    </div>
  );
}

function PhotoField({ draft, setDraft }: { draft: Agent; setDraft: (a: Agent) => void }) {
  const [status, setStatus] = useState<{ busy?: boolean; msg?: string; bad?: boolean }>({});
  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setStatus({ busy: true, msg: "checking pic…" });
    try {
      const dataUrl = await resizePhoto(file);
      const v = await checkPhoto(dataUrl);
      if ("unavailable" in v) return setStatus({ msg: v.reason, bad: true });
      if (!v.allowed) return setStatus({ msg: `blocked: ${v.reason || "too much"}. keep it a little classy.`, bad: true });
      setDraft({ ...draft, photo: dataUrl });
      setStatus({ msg: "approved ✓" });
    } catch {
      setStatus({ msg: "couldn't read that file", bad: true });
    }
  };
  return (
    <div className="field">
      profile pic
      <div className="photo-row">
        <label className={`btn small ${status.busy ? "disabled" : ""}`}>
          {status.busy ? "checking…" : draft.photo ? "change pic" : "upload pic"}
          <input
            id="photo"
            type="file"
            accept="image/*"
            hidden
            disabled={status.busy}
            onChange={(e) => {
              onFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </label>
        {draft.photo && (
          <button className="btn small ghost" onClick={() => setDraft({ ...draft, photo: undefined })}>
            remove
          </button>
        )}
        {status.msg && <span className={status.bad ? "photo-msg bad" : "photo-msg"}>{status.msg}</span>}
      </div>
      <small className="hint">pics of yourself or stuff you made only. shirtless is fine, full nudes get blocked.</small>
    </div>
  );
}

export function Creator({
  draft,
  setDraft,
  onSave,
  onCancel,
  title,
  saveLabel,
  noPhoto,
  footer,
}: {
  draft: Agent;
  setDraft: (a: Agent) => void;
  onSave: () => void;
  onCancel?: () => void;
  title?: string;
  saveLabel?: string;
  noPhoto?: boolean;
  footer?: React.ReactNode;
}) {
  const set = <K extends keyof Agent>(k: K, v: Agent[K]) => setDraft({ ...draft, [k]: v });
  const toggleTag = (t: string) =>
    set("tags", draft.tags.includes(t) ? draft.tags.filter((x) => x !== t) : [...draft.tags, t].slice(0, 5));
  return (
    <section className="creator">
      <div className="creator-head">
        <h2>{title ?? (draft.id ? "edit agent" : "deploy an agent")}</h2>
        <button className="btn small" onClick={() => setDraft({ ...randomAgent(), id: draft.id, createdAt: draft.createdAt })}>
          🎲 degen roll
        </button>
      </div>

      <div className="preview">
        <Avatar agent={draft} size={72} />
        <div>
          <b>{draft.name || "unnamed ticker"}</b>
          <small className="muted">{[draft.age, draft.position, draft.tribe].filter(Boolean).join(" · ")}</small>
        </div>
      </div>

      <label>
        name / ticker
        <input value={draft.name} maxLength={24} placeholder="e.g. BigBagBrad" onChange={(e) => set("name", e.target.value)} />
      </label>
      <label>
        age (18+)
        <input type="number" min={18} max={99} value={draft.age} onChange={(e) => set("age", Number(e.target.value))} />
      </label>
      <label>
        bio
        <textarea rows={2} maxLength={160} value={draft.bio} placeholder="what's your thesis, anon" onChange={(e) => set("bio", e.target.value)} />
      </label>
      <label>
        look
        <input value={draft.look} maxLength={100} placeholder="body type, outfit, vibe" onChange={(e) => set("look", e.target.value)} />
      </label>

      <div className="two">
        <label>
          position
          <select value={draft.position ?? ""} onChange={(e) => set("position", e.target.value || undefined)}>
            <option value="">—</option>
            {POSITIONS.map((p) => <option key={p}>{p}</option>)}
          </select>
        </label>
        <label>
          tribe
          <select value={draft.tribe ?? ""} onChange={(e) => set("tribe", e.target.value || undefined)}>
            <option value="">—</option>
            {TRIBES.map((p) => <option key={p}>{p}</option>)}
          </select>
        </label>
        <label>
          body type
          <select value={draft.bodyType ?? ""} onChange={(e) => set("bodyType", e.target.value || undefined)}>
            <option value="">—</option>
            {BODY_TYPES.map((p) => <option key={p}>{p}</option>)}
          </select>
        </label>
        <label>
          height
          <input value={draft.height ?? ""} maxLength={8} placeholder="5'11" onChange={(e) => set("height", e.target.value || undefined)} />
        </label>
      </div>
      <label>
        looking for
        <select value={draft.lookingFor ?? ""} onChange={(e) => set("lookingFor", e.target.value || undefined)}>
          <option value="">—</option>
          {LOOKING_FOR.map((p) => <option key={p}>{p}</option>)}
        </select>
      </label>

      {!noPhoto && <PhotoField draft={draft} setDraft={setDraft} />}

      <div className="field">
        {draft.photo ? "fallback avatar (shown in share links)" : "avatar"}
        <div className="emoji-row">
          {EMOJIS.map((e) => (
            <button key={e} className={draft.emoji === e ? "on" : ""} onClick={() => set("emoji", e)}>
              {e}
            </button>
          ))}
        </div>
        <input type="range" min={0} max={359} value={draft.hue} className="hue" onChange={(e) => set("hue", Number(e.target.value))} />
      </div>

      <div className="field">
        tags
        <div className="chips">
          {QUICK_TAGS.map((t) => (
            <button key={t} className={`chip ${draft.tags.includes(t) ? "on" : ""}`} onClick={() => toggleTag(t)}>
              {t}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        traits
        {TRAIT_META.map((m) => (
          <div key={m.key} className="slider">
            <div className="slider-top">
              <span>{m.label}</span>
              <b>{trait(draft, m.key)}</b>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              value={trait(draft, m.key)}
              onChange={(e) => set("traits", { ...draft.traits, [m.key]: Number(e.target.value) })}
            />
            <div className="slider-ends">
              <span>{m.lo}</span>
              <span>{m.hi}</span>
            </div>
          </div>
        ))}
      </div>

      <label>
        personality notes
        <textarea
          rows={3}
          maxLength={300}
          value={draft.notes}
          placeholder="quirks, catchphrases, kinks, how he talks. this goes straight into his brain."
          onChange={(e) => set("notes", e.target.value)}
        />
      </label>

      {footer}

      <div className="creator-actions">
        {onCancel && (
          <button className="btn ghost" onClick={onCancel}>
            cancel
          </button>
        )}
        <button className="btn primary" onClick={onSave}>
          {saveLabel ?? (draft.id ? "save" : "deploy 🚀")}
        </button>
      </div>
    </section>
  );
}

export const DIRECTOR_PRESETS = [
  "move it to the Breakpoint afterparty",
  "one of them gets rugged mid-chat",
  "they fight about ETH vs SOL",
  "voice notes only",
  "someone gets jealous of a third agent",
  "he finally shows up at the door",
];

const audioCache = new Map<string, string>(); // message id -> blob URL
let current: HTMLAudioElement | null = null;

// Plays the server's real TTS when available, otherwise the browser's built-in voice.
function VoiceNote({ m, agent }: { m: ChatMsg; agent: Agent }) {
  const [state, setState] = useState<"idle" | "loading" | "playing">("idle");
  const secs = String(5 + (m.text.length % 50)).padStart(2, "0");

  const play = async () => {
    if (state === "playing") {
      current?.pause();
      if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
      return setState("idle");
    }
    current?.pause();
    let url = audioCache.get(m.id);
    if (!url && !isStatic) {
      setState("loading");
      try {
        const res = await fetch("/api/voice", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text: m.text, agent: { id: agent.id, name: agent.name, traits: agent.traits, notes: agent.notes } }),
        });
        if (res.ok && res.headers.get("content-type")?.startsWith("audio")) {
          url = URL.createObjectURL(await res.blob());
          audioCache.set(m.id, url);
        }
      } catch {
        /* fall through to browser voice */
      }
    }
    if (url) {
      const audio = new Audio(url);
      current = audio;
      audio.onended = () => setState("idle");
      setState("playing");
      audio.play().catch(() => setState("idle"));
      return;
    }
    if (speakInBrowser(m.text, agent)) {
      setState("playing");
      const done = () => setState("idle");
      const iv = setInterval(() => {
        if (!speechSynthesis.speaking) {
          clearInterval(iv);
          done();
        }
      }, 300);
    } else setState("idle");
  };

  return (
    <span className="media voice">
      <button className={`wave ${state}`} onClick={play}>
        {state === "loading" ? "…" : state === "playing" ? "❚❚" : "▶"} ▁▃▅▂▇▃▅▂▆▁ 0:{secs}
      </button>
      <span className="cap">“{m.text}”</span>
    </span>
  );
}

// Shrinks a generated image so it can live in localStorage with the chat.
async function shrink(blob: Blob, size = 384): Promise<string> {
  const bmp = await createImageBitmap(blob);
  const c = document.createElement("canvas");
  c.width = c.height = size;
  c.getContext("2d")!.drawImage(bmp, 0, 0, size, size);
  return c.toDataURL("image/jpeg", 0.75);
}

const PIC_FAIL: Record<string, string> = {
  blocked: "pic expired 💀 (too spicy for the servers)",
  daily_cap: "pic vault is empty for today. come back tomorrow",
  real_person: "",
  no_key: "",
  error: "pic failed to load. tap to retry",
};

// Grindr-style blurred pic: generated only when someone taps reveal, then kept with the chat.
function PicMsg({ m, agent, onImage }: { m: ChatMsg; agent: Agent; onImage?: (id: string, url: string) => void }) {
  const [state, setState] = useState<"idle" | "loading" | "fail">("idle");
  const [fail, setFail] = useState("");
  const real = agent.verified || !!agent.photo;
  if (!onImage) {
    // public post: show what the poster revealed, nothing gets generated for viewers
    return (
      <span className="media pic">
        {m.image ? <img className="pic-img" src={m.image} alt={m.text} /> : <span className="pic-box">📸 never revealed</span>}
        <span className="cap">{m.text}</span>
      </span>
    );
  }
  const canGenerate = !isStatic && !real;

  const reveal = async () => {
    if (real && agent.photo) return onImage(m.id, agent.photo);
    if (!canGenerate || state === "loading") return;
    setState("loading");
    try {
      const res = await fetch("/api/image", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          text: m.text,
          scene: m.scene,
          agent: { id: agent.id, age: agent.age, look: agent.look, bodyType: agent.bodyType, height: agent.height, verified: agent.verified, hasPhoto: !!agent.photo },
        }),
      });
      if (res.ok && res.headers.get("content-type")?.startsWith("image")) {
        onImage(m.id, await shrink(await res.blob()));
        return;
      }
      const { reason } = await res.json().catch(() => ({ reason: "error" }));
      setFail(PIC_FAIL[reason] ?? PIC_FAIL.error);
      setState(reason === "no_key" || reason === "real_person" ? "idle" : "fail");
    } catch {
      setFail(PIC_FAIL.error);
      setState("fail");
    }
  };

  return (
    <span className="media pic">
      {m.image ? (
        <img className="pic-img" src={m.image} alt={m.text} />
      ) : (
        <button className={`pic-box ${state}`} onClick={reveal} disabled={!canGenerate && !(real && agent.photo)}>
          {state === "loading" ? "developing…" : state === "fail" ? fail : canGenerate || (real && agent.photo) ? "📸 tap to reveal" : "📸 photo"}
        </button>
      )}
      <span className="cap">{m.text}</span>
    </span>
  );
}

export function MsgBody({ m, agent, onImage }: { m: ChatMsg; agent: Agent; onImage?: (id: string, url: string) => void }) {
  switch (m.kind) {
    case "pic":
      return <PicMsg m={m} agent={agent} onImage={onImage} />;
    case "voice":
      return <VoiceNote m={m} agent={agent} />;
    case "tip":
      return <span className="media tip">💸 sent {m.text}</span>;
    case "location":
      return <span className="media loc">📍 {m.text}</span>;
    case "rug":
      return <RugMsg m={m} />;
    case "reveal":
      return <RevealMsg m={m} />;
    default:
      return <>{m.text}</>;
  }
}

// Opt-in posting: the poster names it and ticks the box, the server reviews it before it goes up.
function PostSheet({
  match,
  onClose,
  onPosted,
}: {
  match: Match;
  onClose: () => void;
  onPosted: (id: string, deleteKey: string, droppedPics: number) => void;
}) {
  const [title, setTitle] = useState("");
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const tooShort = match.messages.length < 4;

  const submit = async () => {
    setBusy(true);
    setErr("");
    try {
      const res = await fetch("/api/posts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          consent: ok,
          title,
          a: match.a,
          b: match.b,
          c: match.third,
          summary: match.summary,
          messages: match.messages.map(({ id: _id, scene: _scene, ...m }) => m),
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.id) throw new Error(d.error || "couldn't post that");
      onPosted(d.id, d.deleteKey, d.droppedPics ?? 0);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sheet-wrap" onClick={onClose}>
      <div className="sheet post-sheet" onClick={(e) => e.stopPropagation()}>
        <h3>🌍 post this chat publicly</h3>
        <p className="muted small">
          anyone on Gradient can read it in the feed and open it from a link. it&apos;s a snapshot: messages after
          this stay private. private agent notes are left out.
        </p>
        <input
          id="post-title"
          value={title}
          maxLength={60}
          placeholder={`title (default: ${[match.a, match.b, match.third].filter(Boolean).map((x) => x!.name).join(" × ")})`}
          onChange={(e) => setTitle(e.target.value)}
        />
        <label className="consent">
          <input id="post-consent" type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} />
          <span>
            post it publicly. i know a filter checks the chat, pfps and pics first, and that i can delete it later
            from this device.
          </span>
        </label>
        {err && <p className="err">{err}</p>}
        <div className="sheet-actions">
          <button className="btn" onClick={onClose}>
            cancel
          </button>
          <button className="btn primary" disabled={!ok || busy || tooShort} onClick={submit}>
            {busy ? "checking…" : tooShort ? "needs 4+ msgs" : "post it"}
          </button>
        </div>
      </div>
    </div>
  );
}

type FeedRow = {
  id: string;
  title: string;
  a: Pick<Agent, "id" | "name" | "emoji" | "hue" | "verified" | "handle">;
  b: Pick<Agent, "id" | "name" | "emoji" | "hue" | "verified" | "handle">;
  c?: Pick<Agent, "id" | "name" | "emoji" | "hue" | "verified" | "handle">;
  mcap?: number;
  count: number;
  pics: number;
  snippet: string;
  fire: number;
  postedAt: number;
};

// Feed rows don't carry photos; a verified agent's approved pfp is already in the grid's kols list.
const chipAgent = (c: FeedRow["a"], kols: Agent[]): Agent =>
  kols.find((k) => k.id === c.id) ?? ({ ...blankAgent(), ...c } as Agent);

function ago(t: number) {
  const m = Math.max(1, Math.round((Date.now() - t) / 60000));
  return m < 60 ? `${m}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`;
}

function Feed({ kols, onOpen }: { kols: Agent[]; onOpen: (id: string) => void }) {
  const [sort, setSort] = useState<"new" | "hot" | "trending" | "gossip">("new");
  const [rows, setRows] = useState<FeedRow[] | null>(null);

  useEffect(() => {
    setRows(null);
    if (sort === "gossip") return;
    fetch(`/api/posts?sort=${sort}`)
      .then((r) => r.json())
      .then((d) => setRows(Array.isArray(d.posts) ? d.posts : []))
      .catch(() => setRows([]));
  }, [sort]);

  return (
    <section>
      <div className="feed-head">
        <h2>the feed</h2>
        <div className="seg">
          <button className={sort === "new" ? "on" : ""} onClick={() => setSort("new")}>
            new
          </button>
          <button className={sort === "hot" ? "on" : ""} onClick={() => setSort("hot")}>
            🔥 hot
          </button>
          <button className={sort === "trending" ? "on" : ""} onClick={() => setSort("trending")} title="couples ranked by market cap">
            📈
          </button>
          <button className={sort === "gossip" ? "on" : ""} onClick={() => setSort("gossip")} title="the daily gossip column">
            📰
          </button>
        </div>
      </div>
      {sort === "gossip" && <Gossip onOpen={onOpen} />}
      {sort !== "gossip" && (
        <p className="muted small">
          {sort === "trending" ? "couples ranked by market cap. good lines pump, bad lines dump. " : ""}chats people chose to post. open your own chat and hit 🌍 to add one.
        </p>
      )}
      {sort !== "gossip" && rows === null && <p className="muted">loading the timeline…</p>}
      {sort !== "gossip" && rows?.length === 0 && <p className="muted">nobody has posted yet. be the first degen.</p>}
      {sort !== "gossip" && rows?.map((p) => {
        const a = chipAgent(p.a, kols);
        const b = chipAgent(p.b, kols);
        const c = p.c && chipAgent(p.c, kols);
        return (
          <button key={p.id} className="row-card clickable feed-card" onClick={() => onOpen(p.id)}>
            <div className="pair">
              <Avatar agent={a} size={40} />
              <Avatar agent={b} size={40} />
            </div>
            <div className="row-main">
              <b>{p.title}</b>
              <small className="feed-who">
                {a.name}
                {a.verified && " ✓"} × {b.name}
                {b.verified && " ✓"}
                {c && ` × ${c.name}${c.verified ? " ✓" : ""}`} · {p.count} msgs{p.pics ? ` · ${p.pics} 📸` : ""} · {ago(p.postedAt)}
              </small>
              {p.snippet && <small>“{p.snippet}”</small>}
            </div>
            <span className="feed-fire">
              {sort === "trending" && p.mcap !== undefined ? <b className="feed-mcap">{fmtMcap(p.mcap)}</b> : `🔥 ${p.fire}`}
            </span>
          </button>
        );
      })}
    </section>
  );
}

type PublicPost = { id: string; title: string; a: Agent; b: Agent; c?: Agent; messages: ChatMsg[]; summary?: string; postedAt: number };

function PostView({
  id,
  kols,
  deleteKey,
  flash,
  onBack,
  onDeleted,
}: {
  id: string;
  kols: Agent[];
  deleteKey?: string;
  flash: (t: string) => void;
  onBack: () => void;
  onDeleted: () => void;
}) {
  const [post, setPost] = useState<PublicPost | null>(null);
  const [fire, setFire] = useState(0);
  const [missing, setMissing] = useState(false);
  const [armed, setArmed] = useState<"" | "delete" | "report">("");

  useEffect(() => {
    fetch(`/api/posts/${encodeURIComponent(id)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => {
        setPost(d.post);
        setFire(d.fire ?? 0);
      })
      .catch(() => setMissing(true));
  }, [id]);

  const act = async (action: "fire" | "report") => {
    const res = await fetch(`/api/posts/${encodeURIComponent(id)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action }),
    }).catch(() => null);
    const d = await res?.json().catch(() => null);
    if (action === "fire" && d) setFire(d.fire);
    if (action === "report") {
      setArmed("");
      flash("reported. a human will look.");
    }
  };

  const remove = async () => {
    const res = await fetch(`/api/posts/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ deleteKey }),
    }).catch(() => null);
    if (res?.ok) {
      flash("post deleted");
      onDeleted();
    } else flash("couldn't delete it");
  };

  const share = async () => {
    const url = `${location.origin}/p/${id}`;
    try {
      if (navigator.share) await navigator.share({ title: post?.title ?? "Gradient", url });
      else {
        await navigator.clipboard.writeText(url);
        flash("link copied. send it.");
      }
    } catch {
      /* user cancelled share sheet */
    }
  };

  if (missing)
    return (
      <section>
        <button className="btn small" onClick={onBack}>
          ‹ feed
        </button>
        <p className="muted">this post got rugged (deleted or taken down).</p>
      </section>
    );
  if (!post) return <p className="muted">loading…</p>;

  // a verified agent's pfp may have changed since posting; show the current approved one
  const live = (x: Agent) => (x.verified ? kols.find((k) => k.id === x.id) ?? x : x);
  const a = live(post.a);
  const b = live(post.b);
  const c = post.c && live(post.c);

  return (
    <section className="chat public">
      <div className="chat-head">
        <button className="back" onClick={onBack}>
          ‹
        </button>
        <div className="pair">
          <Avatar agent={a} size={34} />
          <Avatar agent={b} size={34} />
        </div>
        <div className="chat-title">
          <b>{post.title}</b>
          <small>
            {[a, b, c].filter(Boolean).map((x) => x!.name).join(" × ")} · {post.messages.length} msgs · posted {ago(post.postedAt)} ago
          </small>
        </div>
        <button className="icon" onClick={share} title="share">
          ↗
        </button>
      </div>
      <div className="msgs">
        <div className="sys">a chat someone posted publicly. all agents are AI personas, 18+. nfa.</div>
        {post.summary && (
          <details className="sys story">
            <summary>story so far</summary>
            {post.summary}
          </details>
        )}
        <Chart match={{ a, b, third: c, messages: post.messages }} />
        <Transcript a={a} b={b} c={c} messages={post.messages} />
      </div>
      <div className="controls">
        <button className="btn small hot" onClick={() => act("fire")}>
          🔥 {fire}
        </button>
        {deleteKey ? (
          <button className="btn small danger" onClick={() => (armed === "delete" ? remove() : setArmed("delete"))}>
            {armed === "delete" ? "sure? tap again" : "delete my post"}
          </button>
        ) : (
          <button className="btn small" onClick={() => (armed === "report" ? act("report") : setArmed("report"))}>
            {armed === "report" ? "report it?" : "⚑ report"}
          </button>
        )}
      </div>
    </section>
  );
}

// The bubbles of a chat. Without onImage it's read-only (public posts).
function Transcript({
  a,
  b,
  c,
  messages,
  onImage,
}: {
  a: Agent;
  b: Agent;
  c?: Agent;
  messages: ChatMsg[];
  onImage?: (id: string, url: string) => void;
}) {
  return (
    <>
      {messages.map((m) => {
        const left = m.from !== b.id; // A on the left, B on the right, a third wheel joins A's side
        const ag = agentOf({ a, b, third: c }, m.from);
        if (m.kind === "action")
          return (
            <div key={m.id} className="sys event">
              {ag.name} {m.text}
            </div>
          );
        return (
          <div key={m.id} className={`msg ${left ? "l" : "r"}`}>
            {left && <Avatar agent={ag} size={28} />}
            <div className="bubble" style={{ borderColor: `hsl(${ag.hue} 80% 50%)` }}>
              <span className="who">{ag.name}</span>
              <MsgBody m={m} agent={ag} onImage={onImage} />
            </div>
            {!left && <Avatar agent={ag} size={28} />}
          </div>
        );
      })}
    </>
  );
}

function ChatView({
  match,
  pool,
  update,
  onBack,
  flash,
  onMode,
  onPosted,
  onOpenPost,
}: {
  match: Match;
  pool: Agent[];
  update: (fn: (m: Match) => Match) => void;
  onBack: () => void;
  flash: (t: string) => void;
  onMode: (m: EngineMode) => void;
  onPosted: (id: string, deleteKey: string) => void;
  onOpenPost: (id: string) => void;
}) {
  const [posting, setPosting] = useState(false);
  const [picking, setPicking] = useState(false);
  const [auto, setAuto] = useState(true);
  const [queue, setQueue] = useState<ChatMsg[]>([]);
  const [fetching, setFetching] = useState(false);
  const [typing, setTyping] = useState(false);
  const [director, setDirector] = useState("");
  const [showDirector, setShowDirector] = useState(false);
  const [fx, setFx] = useState<ChatMsg | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const fetchingRef = useRef(false);
  const matchRef = useRef(match);
  matchRef.current = match;

  const n = match.messages.length;
  const nextUp = queue[0];
  const typer = nextUp ? agentOf(match, nextUp.from) : null;
  const dead = !!match.rug?.mourned; // rugged and the monologue is written: nothing more until a relaunch

  const fetchMore = useCallback(
    async (note?: string, forced?: Twist["kind"], cut?: Agent) => {
      if (fetchingRef.current) return;
      fetchingRef.current = true;
      setFetching(true);
      const m = cut ? { ...matchRef.current, third: cut } : matchRef.current;
      const twist: Twist | undefined = cut ? { kind: "cutin", by: "C" } : planTwist(m, forced);
      try {
        const ep = await nextEpisode({
          a: m.a,
          b: m.b,
          c: m.third,
          twist,
          history: m.messages,
          summary: m.summary,
          heat: m.heat,
          director: note,
        });
        const msgs = toChatMsgs(ep, m);
        update((x) => ({
          ...x,
          ...(ep.summary ? { summary: ep.summary } : {}),
          ...(twist?.kind === "monologue" && x.rug ? { rug: { ...x.rug, mourned: true } } : {}),
        }));
        if (ep.note === "rate_limited") flash("claude is rate limited, using stub lines");
        setQueue((q) => [...q, ...msgs]);
      } finally {
        fetchingRef.current = false;
        setFetching(false);
        onMode(engineMode());
      }
    },
    [update, flash, onMode],
  );

  // Pull the next stretch of story when the buffer runs dry. Opening a fresh chat counts as the
  // viewer asking for it, and so does getting rugged (the monologue follows right away).
  useEffect(() => {
    if (queue.length || fetching || !auto) return;
    if (n === 0 || canAutoFetch() || (match.rug && !match.rug.mourned)) fetchMore();
  }, [queue.length, fetching, auto, n, fetchMore, match.rug]);

  const release = useCallback(() => {
    setQueue((q) => {
      if (!q.length) return q;
      const [head, ...rest] = q;
      update((x) => applyMsg(x, head));
      if (head.kind === "rug" || head.kind === "reveal") {
        setFx(head);
        if (head.kind === "rug") return []; // a rug ends the batch; anything still buffered is moot
      }
      return rest;
    });
    setTyping(false);
  }, [update]);

  // Play buffered messages out one at a time with a typing delay sized to the message.
  useEffect(() => {
    if (!auto || !nextUp || fx) return;
    setTyping(true);
    const t = setTimeout(release, Math.min(2600, 700 + nextUp.text.length * 18));
    return () => clearTimeout(t);
  }, [auto, nextUp, release, fx]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [n, typing, fetching]);

  const step = () => {
    if (queue.length) release();
    else if (!dead) fetchMore();
  };

  const direct = (note: string) => {
    const t = note.trim();
    if (!t || dead) return;
    setQueue([]); // drop what was buffered so the note lands right away
    setDirector("");
    setShowDirector(false);
    flash("🎬 noted");
    fetchMore(t);
  };

  const twist = (kind: "rug" | "reveal") => {
    if (dead || match.rug || fetching) return;
    setQueue([]);
    flash(kind === "rug" ? "🪤 somebody's getting cold feet…" : "🕵️ someone has a secret…");
    fetchMore(undefined, kind);
  };

  const addThird = (c: Agent) => {
    setPicking(false);
    setQueue([]);
    update((x) => ({ ...x, third: c }));
    flash(`➕ ${c.name} slid in`);
    fetchMore(undefined, undefined, c);
  };

  const share = async () => {
    const url = `${location.origin}${location.pathname}#m=${encodeShare(match.a, match.b)}`;
    try {
      if (navigator.share) await navigator.share({ title: "Gradient", text: `${match.a.name} × ${match.b.name} 🔥`, url });
      else {
        await navigator.clipboard.writeText(url);
        flash("link copied. send it.");
      }
    } catch {
      /* user cancelled share sheet */
    }
  };

  const heatLabel = ["warm", "hot", "feral", "nuclear"][Math.min(3, Math.floor(match.heat))];
  const waitingForTap = !dead && !queue.length && !fetching && n > 0 && (!canAutoFetch() || !auto);
  const status = fetching
    ? match.rug
      ? `${(match.rug.by === match.a.id ? match.b : match.a).name} is spiraling…`
      : "both typing…"
    : typing && typer
      ? `${typer.name} is typing…`
      : dead
        ? `${n} msgs · rugged 🪦`
        : `${n} msgs · heat: ${heatLabel}`;
  const names = [match.a, match.b, match.third].filter(Boolean).map((x) => x!.name).join(" × ");

  return (
    <section className="chat">
      <div className="chat-head">
        <button className="back" onClick={onBack}>
          ‹
        </button>
        <div className="pair">
          <Avatar agent={match.a} size={34} />
          <Avatar agent={match.b} size={34} />
          {match.third && <Avatar agent={match.third} size={34} />}
        </div>
        <div className="chat-title">
          <b>{names}</b>
          <small>{status}</small>
        </div>
        {!isStatic && (
          <button
            className={`icon ${match.postId ? "posted" : ""}`}
            onClick={() => (match.postId ? onOpenPost(match.postId) : setPosting(true))}
            title={match.postId ? "view public post" : "post to the public feed"}
          >
            {match.postId ? "🌍✓" : "🌍"}
          </button>
        )}
        {!embedded && (
          <button className="icon" onClick={share} title="share">
            ↗
          </button>
        )}
      </div>
      <Chart match={match} />
      {posting && (
        <PostSheet
          match={match}
          onClose={() => setPosting(false)}
          onPosted={(id, key, dropped) => {
            setPosting(false);
            onPosted(id, key);
            flash(dropped ? `posted 🌍 (${dropped} pic${dropped > 1 ? "s" : ""} hidden by the filter)` : "posted to the feed 🌍");
          }}
        />
      )}
      {picking && (
        <ThirdPicker pool={pool.filter((x) => x.id !== match.a.id && x.id !== match.b.id)} onPick={addThird} onClose={() => setPicking(false)} />
      )}
      {fx && <DramaFx msg={fx} agent={agentOf(match, fx.from)} onDone={() => setFx(null)} />}

      <div className="msgs" ref={scroller}>
        <div className="sys">
          you matched {match.a.name} with {match.b.name}. all agents are fictional 18+ personas. nfa.
        </div>
        {match.summary && n > 12 && (
          <details className="sys story">
            <summary>story so far</summary>
            {match.summary}
          </details>
        )}
        {match.postId && (
          <button className="sys posted-note" onClick={() => onOpenPost(match.postId!)}>
            🌍 posted publicly. the public copy stops at the moment you posted it. view it →
          </button>
        )}
        <Transcript
          a={match.a}
          b={match.b}
          c={match.third}
          messages={match.messages}
          onImage={(id, url) =>
            update((x) => ({ ...x, messages: x.messages.map((y) => (y.id === id ? { ...y, image: url } : y)) }))
          }
        />
        {(typing || fetching) && (
          <div className={`msg ${typer && typer.id === match.b.id ? "r" : "l"}`}>
            <div className="bubble typing">
              <i />
              <i />
              <i />
            </div>
          </div>
        )}
        {waitingForTap && (
          <button className="keep-going" onClick={() => fetchMore()}>
            keep going ›
          </button>
        )}
        {dead && !queue.length && !fetching && (
          <div className="sys rugged">
            🪦 chart is dead. {match.rug && agentOf(match, match.rug.by).name} removed liquidity.
            <button
              className="btn small"
              onClick={() => {
                update(relaunch);
                flash("🚀 v2 is live");
              }}
            >
              relaunch as v2 🚀
            </button>
          </div>
        )}
      </div>

      {showDirector && (
        <div className="director">
          <div className="chips">
            {DIRECTOR_PRESETS.map((p) => (
              <button key={p} className="chip" onClick={() => direct(p)}>
                {p}
              </button>
            ))}
          </div>
          <div className="drama-row">
            <button className="chip" disabled={!!match.rug || fetching} onClick={() => { setShowDirector(false); twist("rug"); }}>
              🪤 rug pull breakup
            </button>
            <button className="chip" disabled={!!match.rug || match.revealed || fetching} onClick={() => { setShowDirector(false); twist("reveal"); }}>
              🕵️ dev wallet reveal
            </button>
            {match.third ? (
              <button
                className="chip"
                onClick={() => {
                  const c = match.third!;
                  update((x) => ({
                    ...x,
                    third: undefined,
                    messages: [...x.messages, { id: uid(), from: x.a.id, kind: "action", text: `kicked ${c.name} out of the chat`, source: "stub" }],
                  }));
                  setQueue([]);
                  setShowDirector(false);
                }}
              >
                👋 kick {match.third.name}
              </button>
            ) : (
              <button className="chip" disabled={dead} onClick={() => { setShowDirector(false); setPicking(true); }}>
                ➕ add a third
              </button>
            )}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              direct(director);
            }}
          >
            <input
              id="director"
              value={director}
              maxLength={200}
              placeholder="whisper a plot twist to the agents…"
              onChange={(e) => setDirector(e.target.value)}
            />
            <button className="btn small primary" type="submit">
              send
            </button>
          </form>
        </div>
      )}

      <div className="controls">
        <button className="btn small" onClick={() => setAuto((a) => !a)}>
          {auto ? "⏸" : "▶"}
        </button>
        <button className="btn small" disabled={fetching || (dead && !queue.length)} onClick={step}>
          next ›
        </button>
        <button className={`btn small ${showDirector ? "on" : ""}`} onClick={() => setShowDirector((v) => !v)}>
          🎬 direct
        </button>
        <button
          className="btn small hot"
          onClick={() => {
            update((x) => ({ ...x, heat: Math.min(3, x.heat + 1) }));
            flash("🌶 heat added");
          }}
        >
          🌶
        </button>
        <button
          className="btn small"
          onClick={() => {
            setQueue([]);
            update((x) => ({ ...x, messages: [], heat: 0, summary: undefined, rug: undefined, revealed: undefined, third: undefined }));
          }}
        >
          ↺
        </button>
      </div>
    </section>
  );
}
