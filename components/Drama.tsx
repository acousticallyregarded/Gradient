"use client";

import { useEffect, useState } from "react";
import { chartOf, fmtMcap, GRADUATE_MCAP, LAUNCH_MCAP, mcapOf, tickerOf } from "@/lib/drama";
import { pronouns, type Agent, type ChatMsg, type Match } from "@/lib/types";
import { Avatar } from "@/components/GradientApp";
import { Icon, Verified } from "@/components/Art";

// Bonding curve rizz: the couple's coin, pumping on good lines and dumping on bad ones.
export function Chart({ match, compact }: { match: Pick<Match, "a" | "b" | "third" | "messages" | "rug">; compact?: boolean }) {
  const pts = chartOf(match.messages).slice(-60);
  const now = pts.at(-1) ?? 1;
  const mcap = now * LAUNCH_MCAP;
  const prev = pts.at(-9) ?? pts[0];
  const change = ((now - prev) / prev) * 100;
  const up = change >= 0;
  const w = compact ? 80 : 120;
  const h = compact ? 22 : 30;
  const lo = Math.min(...pts);
  const hi = Math.max(...pts);
  const line = pts
    .map((p, i) => {
      const x = pts.length > 1 ? (i / (pts.length - 1)) * w : w;
      const y = hi === lo ? h / 2 : h - ((p - lo) / (hi - lo)) * (h - 2) - 1;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const status = match.rug ? "rugged" : mcap >= GRADUATE_MCAP ? "graduated" : `${up ? "▲" : "▼"} ${Math.abs(change).toFixed(0)}%`;
  return (
    <div className={`chart ${up && !match.rug ? "up" : "down"} ${compact ? "compact" : ""}`} title="the couple's coin: good lines pump it, bad lines dump it">
      {!compact && <b className="chart-ticker">{tickerOf(match.a, match.b, match.third)}</b>}
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
        <polyline points={line} fill="none" strokeWidth="1.6" strokeLinejoin="round" />
      </svg>
      <span className="chart-mcap">
        {fmtMcap(mcap)}
        <small>{status}</small>
      </span>
    </div>
  );
}

// The full-screen beat when a rug or a reveal lands. Shown once, when the message is released.
export function DramaFx({ msg, agent, onDone }: { msg: ChatMsg; agent: Agent; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, msg.kind === "rug" ? 3200 : 3600);
    return () => clearTimeout(t);
  }, [msg.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (msg.kind === "rug")
    return (
      <div className="fx rug" onClick={onDone}>
        <div className="fx-candle" />
        <h1>LIQUIDITY REMOVED</h1>
        <p>
          {agent.name} pulled the rug. chart: -96%. <br />
          {pronouns(agent).he === "they" ? "they're" : `${pronouns(agent).he}'s`} gone.
        </p>
      </div>
    );
  return (
    <div className="fx reveal" onClick={onDone}>
      <Icon name="siren" size={72} />
      <h1>DEV WALLET REVEALED</h1>
      <Avatar agent={agent} size={80} />
      <p>{agent.name} has a confession.</p>
    </div>
  );
}

// Inline bubbles for the two drama message kinds.
export function RugMsg({ m }: { m: ChatMsg }) {
  return (
    <span className="media rug-msg">
      <span className="rug-tag">
        <Icon name="rug" size={16} /> pulled liquidity
      </span>
      {m.text}
    </span>
  );
}

export function RevealMsg({ m }: { m: ChatMsg }) {
  return (
    <span className="media reveal-msg">
      <span className="reveal-tag">
        <Icon name="siren" size={16} /> dev wallet reveal
      </span>
      {m.text}
    </span>
  );
}

// Threesome mode: pick who slides into the chat.
export function ThirdPicker({ pool, onPick, onClose }: { pool: Agent[]; onPick: (a: Agent) => void; onClose: () => void }) {
  return (
    <div className="sheet-wrap" onClick={onClose}>
      <div className="sheet third-sheet" onClick={(e) => e.stopPropagation()}>
        <h3>
          <Icon name="third" size={28} /> add a third
        </h3>
        <p className="muted small">pick who slides into this chat. all three agents get lines from here on.</p>
        <div className="third-list">
          {pool.map((a) => (
            <button key={a.id} className="row-card clickable" onClick={() => onPick(a)}>
              <Avatar agent={a} size={36} />
              <div className="row-main">
                <b>
                  {a.name}
                  {a.verified && <Verified size={13} />}
                </b>
                <small>{a.bio}</small>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// The trending board: couples ranked by market cap.
export function TrendingBoard({ matches, onOpen }: { matches: Match[]; onOpen: (id: string) => void }) {
  const top = matches
    .filter((m) => m.messages.length >= 4)
    .map((m) => ({ m, mcap: mcapOf(m.messages) }))
    .sort((x, y) => y.mcap - x.mcap)
    .slice(0, 5);
  if (!top.length) return null;
  return (
    <div className="trending">
      <small>
        <Icon name="trending" size={18} /> trending couples
      </small>
      {top.map(({ m }, i) => (
        <button key={m.id} className="trend-row" onClick={() => onOpen(m.id)}>
          <span className="trend-rank">#{i + 1}</span>
          <span className="trend-name">{tickerOf(m.a, m.b, m.third)}</span>
          <Chart match={m} compact />
        </button>
      ))}
    </div>
  );
}

type Column = {
  date: string;
  headline: string;
  intro: string;
  items: { postId: string; title: string; blurb: string }[];
  blind?: string;
  source: "claude" | "stub";
};

// Daily drama: the gossip column, written once a day from the best public feed posts.
export function Gossip({ onOpen }: { onOpen: (id: string) => void }) {
  const [col, setCol] = useState<Column | null | undefined>(undefined);
  useEffect(() => {
    fetch("/api/gossip")
      .then((r) => r.json())
      .then((d) => setCol(d.column ?? null))
      .catch(() => setCol(null));
  }, []);
  if (col === undefined) return <p className="muted">the gossip columnist is still hungover…</p>;
  if (!col) return <p className="muted">no tea yet. post some chats to the feed and the column writes itself tomorrow.</p>;
  return (
    <article className="gossip">
      <small className="gossip-date">
        <Icon name="gossip" size={20} /> the liquidity pool · {col.date}
      </small>
      <h3>{col.headline}</h3>
      <p className="gossip-intro">{col.intro}</p>
      {col.items.map((it) => (
        <button key={it.postId} className="gossip-item" onClick={() => onOpen(it.postId)}>
          <b>{it.title}</b>
          <span>{it.blurb}</span>
          <small>read the chat →</small>
        </button>
      ))}
      {col.blind && (
        <p className="gossip-blind">
          <b>blind item:</b> {col.blind}
        </p>
      )}
      <p className="muted small">written from chats people chose to post publicly. all agents are fictional AI personas.</p>
    </article>
  );
}
