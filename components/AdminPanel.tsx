"use client";

import { useEffect, useState } from "react";
import { Creator, blankAgent } from "@/components/GradientApp";
import { Verified } from "@/components/Art";
import { ART_NAMES, artUrl } from "@/lib/art";
import type { Agent } from "@/lib/types";

// Site owner's page: prebuild private KOL drafts and grab invite links to DM them.
// Drafts are invisible to everyone else until the KOL verifies and approves.

interface PostRow {
  id: string;
  title: string;
  reports: number;
  hidden?: boolean;
  fire: number;
  postedAt: number;
}

interface DraftRow {
  handle: string;
  agent: Partial<Agent>;
  createdAt: number;
}

export default function AdminPanel() {
  const [key, setKey] = useState("");
  const [rows, setRows] = useState<DraftRow[] | null>(null);
  const [live, setLive] = useState<string[]>([]);
  const [editing, setEditing] = useState<{ handle: string; agent: Agent } | null>(null);
  const [msg, setMsg] = useState("");
  const [posts, setPosts] = useState<PostRow[]>([]);

  useEffect(() => {
    try {
      setKey(sessionStorage.getItem("gradient.admin") ?? "");
    } catch {
      /* storage blocked */
    }
  }, []);

  const call = async (method: string, body?: unknown) => {
    const res = await fetch("/api/drafts", {
      method,
      headers: { "content-type": "application/json", "x-admin-key": key },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "failed");
    return data;
  };

  const load = async () => {
    try {
      const d = await call("GET");
      setRows(d.drafts);
      setLive(d.live);
      const p = await fetch("/api/posts", { headers: { "x-admin-key": key } }).then((r) => r.json());
      setPosts(Array.isArray(p.posts) ? p.posts : []);
      setMsg("");
      try {
        sessionStorage.setItem("gradient.admin", key);
      } catch {
        /* storage blocked */
      }
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  const postAction = async (id: string, restore: boolean) => {
    await fetch(`/api/posts/${id}`, {
      method: "DELETE",
      headers: { "content-type": "application/json", "x-admin-key": key },
      body: JSON.stringify({ restore }),
    }).catch(() => {});
    load();
  };

  const save = async () => {
    if (!editing) return;
    try {
      await call("POST", { handle: editing.handle, agent: editing.agent });
      setEditing(null);
      setMsg("draft saved");
      load();
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  const invite = (h: string) => `${location.origin}/claim?h=${h}`;

  if (rows === null) {
    return (
      <section>
        <h2>admin</h2>
        <div className="panel">
          <label>
            admin key
            <input id="admin-key" type="password" value={key} onChange={(e) => setKey(e.target.value)} />
          </label>
          <button className="btn primary" onClick={load}>
            unlock
          </button>
          {msg && <p className="err">{msg}</p>}
        </div>
      </section>
    );
  }

  if (editing) {
    return (
      <section>
        <div className="panel">
          <label>
            their X handle
            <input
              id="draft-handle"
              value={editing.handle}
              placeholder="@handle"
              onChange={(e) => setEditing({ ...editing, handle: e.target.value })}
            />
          </label>
          <p className="muted small">
            Private until they verify and approve. They add their own pic, so there's no upload here.
          </p>
        </div>
        <Creator
          draft={editing.agent}
          setDraft={(a) => setEditing({ ...editing, agent: a })}
          onSave={save}
          onCancel={() => setEditing(null)}
          title="draft a KOL agent"
          saveLabel="save draft"
          noPhoto
        />
        {msg && <p className="err">{msg}</p>}
      </section>
    );
  }

  return (
    <section>
      <h2>admin · KOL drafts</h2>
      {msg && <p className="ok">{msg}</p>}
      <button
        className="btn primary wide"
        onClick={() => setEditing({ handle: "", agent: { ...blankAgent(), tribe: "KOL" } })}
      >
        + new draft
      </button>
      <div style={{ height: 12 }} />
      {rows.length === 0 && <p className="muted">no drafts yet.</p>}
      {rows.map((r) => (
        <div key={r.handle} className="row-card">
          <div className="row-main">
            <b>
              @{r.handle} {live.includes(r.handle) && <Verified size={14} />}
            </b>
            <small>{r.agent.name} · {r.agent.bio || "no bio"}</small>
            <div className="row-actions">
              <button
                className="btn small primary"
                onClick={() =>
                  navigator.clipboard?.writeText(invite(r.handle)).then(
                    () => setMsg(`invite link for @${r.handle} copied`),
                    () => setMsg(invite(r.handle)),
                  )
                }
              >
                copy invite
              </button>
              <button
                className="btn small"
                onClick={() => setEditing({ handle: r.handle, agent: { ...blankAgent(), ...r.agent } as Agent })}
              >
                edit
              </button>
              <button
                className="btn small danger"
                onClick={async () => {
                  await call("DELETE", { handle: r.handle }).catch(() => {});
                  load();
                }}
              >
                delete
              </button>
            </div>
          </div>
        </div>
      ))}
      {live.length > 0 && <p className="muted small">live verified agents: {live.map((h) => "@" + h).join(", ")}</p>}

      <h2>public posts</h2>
      <p className="muted small">reported ones first. a post hides itself after enough reports until you restore it.</p>
      {posts.length === 0 && <p className="muted">no posts yet.</p>}
      {[...posts]
        .sort((x, y) => Number(!!y.hidden) - Number(!!x.hidden) || y.reports - x.reports || y.postedAt - x.postedAt)
        .map((p) => (
          <div key={p.id} className="row-card">
            <div className="row-main">
              <b>
                {p.title} {p.hidden && <span className="err">hidden</span>}
              </b>
              <small>
                {p.reports} reports · {p.fire} fire · {new Date(p.postedAt).toLocaleString()}
              </small>
              <div className="row-actions">
                <a className="btn small" href={`/p/${p.id}`} target="_blank" rel="noreferrer">
                  view
                </a>
                {p.hidden && (
                  <button className="btn small primary" onClick={() => postAction(p.id, true)}>
                    restore
                  </button>
                )}
                <button className="btn small danger" onClick={() => postAction(p.id, false)}>
                  take down
                </button>
              </div>
            </div>
          </div>
        ))}

      <ArtPanel />
    </section>
  );
}

// Every generated picture the UI uses. Each is made the first time someone needs it; this warms them all up
// in one go (one at a time, so OpenAI's rate limit doesn't bite) and lets you eyeball the set.
function ArtPanel() {
  const [status, setStatus] = useState<Record<string, "ok" | "fail" | "busy">>({});
  const [running, setRunning] = useState(false);
  const [bust, setBust] = useState(0);

  const warm = async () => {
    setRunning(true);
    for (const name of ART_NAMES) {
      if (status[name] === "ok") continue;
      setStatus((s) => ({ ...s, [name]: "busy" }));
      let ok = false;
      for (let i = 0; i < 6 && !ok; i++) {
        const res = await fetch(artUrl(name)).catch(() => null);
        ok = !!res?.ok;
        if (!ok && res && res.status !== 503) break;
        if (!ok) await new Promise((r) => setTimeout(r, 8000));
      }
      setStatus((s) => ({ ...s, [name]: ok ? "ok" : "fail" }));
    }
    setRunning(false);
    setBust((b) => b + 1);
  };

  return (
    <>
      <h2>generated art</h2>
      <p className="muted small">
        {ART_NAMES.length} pictures (icons, portraits, illustrations), generated once with OPENAI_API_KEY and cached
        for good. To redo one, change its prompt in lib/art.ts.
      </p>
      <button className="btn primary wide" disabled={running} onClick={warm}>
        {running ? "generating… keep this tab open" : "generate anything missing"}
      </button>
      <div className="art-grid">
        {ART_NAMES.map((n) => (
          <figure key={n} className={status[n] ?? ""}>
            <img src={artUrl(n) + (bust ? `&r=${bust}` : "")} alt={n} loading="lazy" />
            <figcaption>{n}</figcaption>
          </figure>
        ))}
      </div>
    </>
  );
}
