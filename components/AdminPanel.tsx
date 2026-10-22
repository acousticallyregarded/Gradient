"use client";

import { useEffect, useState } from "react";
import { Creator, blankAgent } from "@/components/GradientApp";
import type { Agent } from "@/lib/types";

// Site owner's page: prebuild private KOL drafts and grab invite links to DM them.
// Drafts are invisible to everyone else until the KOL verifies and approves.

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
              @{r.handle} {live.includes(r.handle) && <span className="check">✓</span>}
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
    </section>
  );
}
