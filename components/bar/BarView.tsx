"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { EngineMode } from "@/lib/engine";
import { STARTERS } from "@/lib/starters";
import { uid } from "@/lib/storage";
import type { Agent, ChatMsg, Match } from "@/lib/types";
import { Avatar, DIRECTOR_PRESETS, MsgBody } from "@/components/GradientApp";
import { Chart, DramaFx } from "@/components/Drama";
import { AgentPhoto, Glyph, Icon, Verified } from "@/components/Art";
import type { IconName } from "@/lib/art";
import { agentOf, relaunch } from "@/lib/drama";
import { useEpisodes } from "./useEpisodes";
import type { BarWorld } from "./world";

const BARTENDER = "bartender";
const DRINKS = [
  ["a Rug Pull", "one Rug Pull. tastes sweet, then it's gone."],
  ["Exit Liquidity, neat", "Exit Liquidity, neat. drink it before someone else does."],
  ["the Slippage Special", "Slippage Special. you ordered a full one, you'll get about half."],
] as const;

// Opening lines when you walk up, before any model call. Free, and in character from the profile.
function greeting(a: Agent) {
  const looking = a.lookingFor ? ` looking for: ${a.lookingFor.toLowerCase()}.` : "";
  return `${a.bio}${looking}`;
}

export default function BarView({
  me,
  agents,
  choices,
  setAsId,
  matches,
  setMatches,
  flash,
  onMode,
  onProfile,
  onLog,
  guard = (fn) => fn(),
}: {
  me: Agent;
  agents: Agent[];
  choices: Agent[];
  setAsId: (id: string) => void;
  matches: Match[];
  setMatches: (fn: (prev: Match[]) => Match[]) => void;
  flash: (t: string, icon?: IconName) => void;
  onMode: (m: EngineMode) => void;
  onProfile: (a: Agent) => void;
  onLog: (matchId: string) => void;
  guard?: (fn: () => void) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const world = useRef<BarWorld | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [encounter, setEncounter] = useState<string | null>(null);
  const [dateId, setDateId] = useState<string | null>(null);
  const [hint, setHint] = useState(true);
  const lookup = useRef(new Map<string, Agent>());
  lookup.current = new Map(agents.map((a) => [a.id, a]));

  // Latest handlers for the world's callbacks, without rebuilding the scene.
  const handlers = useRef({ select: (_id: string) => {}, arrive: (_id: string) => {} });
  handlers.current.select = (id) => {
    if (dateId) return;
    setHint(false);
    setEncounter(null);
    world.current?.walkTo(id);
  };
  handlers.current.arrive = (id) => setEncounter(id);

  useEffect(() => {
    let w: BarWorld | null = null;
    let dead = false;
    import("./world")
      .then(({ BarWorld }) => {
        if (dead || !host.current) return;
        try {
          w = new BarWorld(host.current, {
            onSelect: (id) => handlers.current.select(id),
            onArrive: (id) => handlers.current.arrive(id),
          });
          world.current = w;
          setLoaded(true);
        } catch {
          setFailed(true); // no WebGL
        }
      })
      .catch(() => setFailed(true));
    return () => {
      dead = true;
      w?.dispose();
      world.current = null;
    };
  }, []);

  const crowdKey = useMemo(
    () => [me, ...agents].map((a) => `${a.id}:${a.name}:${a.emoji}:${a.hue}:${a.photo?.length ?? 0}`).join("|"),
    [me, agents],
  );
  useEffect(() => {
    if (loaded) world.current?.setGuests(me, agents);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, crowdKey]);

  const match = matches.find((m) => m.id === dateId) ?? null;
  useEffect(() => {
    world.current?.showLabels(!encounter);
  }, [encounter]);
  useEffect(() => {
    world.current?.setDate(match ? match.b.id : null);
  }, [match?.b.id, loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  const startDate = (other: Agent, tapped: boolean) => guard(() => {
    const existing = matches.find((m) => m.a.id === me.id && m.b.id === other.id);
    const m: Match = existing ?? { id: uid(), a: me, b: other, messages: [], heat: 0, createdAt: Date.now() };
    if (!existing) setMatches((prev) => [m, ...prev]);
    if (tapped) flash(`tap sent. ${other.name} tapped back.`, "flame");
    setEncounter(null);
    setDateId(m.id);
  });

  const who = encounter && encounter !== BARTENDER ? lookup.current.get(encounter) ?? null : null;

  return (
    <div className="bar-view">
      <div className="bar-stage" ref={host} />
      {!loaded && !failed && <div className="bar-loading">
          <Icon name="bar" size={64} />
          walking in…
        </div>}
      {failed && (
        <div className="bar-loading">
          your browser won't render 3D here. the grid still works.
        </div>
      )}

      {!match && (
        <div className="bar-hud">
          <Avatar agent={me} size={30} />
          <div className="as-text">
            <small>you walked in as</small>
            <select value={me.id} onChange={(e) => setAsId(e.target.value)}>
              {choices.filter((a) => !a.starter).length > 0 && (
                <optgroup label="your agents">
                  {choices
                    .filter((a) => !a.starter)
                    .map((a) => (
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
        </div>
      )}
      {hint && loaded && !encounter && !match && (
        <div className="bar-hint">tap the floor to walk · tap someone to go say hi</div>
      )}

      {encounter === BARTENDER && (
        <div className="vn">
          <div className="vn-box" style={{ ["--hue" as string]: 30 }}>
            <div className="vn-name">bartender</div>
            <Typed text="what're you drinking? everything's on the house, the house is on-chain." />
          </div>
          <div className="vn-choices">
            {DRINKS.map(([label, line]) => (
              <button
                key={label}
                onClick={() => {
                  flash(line);
                  setEncounter(null);
                }}
              >
                <Icon name="cocktail" size={22} /> {label}
              </button>
            ))}
            <button onClick={() => setEncounter(null)}>just looking</button>
          </div>
        </div>
      )}

      {who && (
        <div className="vn">
          <div className="vn-portraits">
            <Portrait agent={me} dim />
            <Portrait agent={who} />
          </div>
          <div className="vn-box" style={{ ["--hue" as string]: who.hue }}>
            <div className="vn-name">
              {who.name}
              {who.verified && <Verified size={14} />}
              <small>
                {who.age} · {who.tribe ?? "anon"} · {who.position ?? "?"}
              </small>
            </div>
            <Typed text={greeting(who)} />
          </div>
          <div className="vn-choices">
            <button className="hot" onClick={() => startDate(who, true)}>
              <Icon name="flame" size={22} /> tap
            </button>
            <button onClick={() => startDate(who, false)}>
              <Icon name="chat" size={22} /> slide into the booth
            </button>
            <button onClick={() => onProfile(who)}>
              <Icon name="eyes" size={22} /> check the profile
            </button>
            <button onClick={() => setEncounter(null)}>walk away</button>
          </div>
        </div>
      )}

      {match && (
        <DateScene
          key={match.id}
          match={match}
          crowd={agents}
          update={(fn) => setMatches((prev) => prev.map((x) => (x.id === match.id ? fn(x) : x)))}
          flash={flash}
          onMode={onMode}
          onLeave={() => setDateId(null)}
          onLog={() => onLog(match.id)}
        />
      )}
    </div>
  );
}

function Portrait({ agent, dim, speaking }: { agent: Agent; dim?: boolean; speaking?: boolean }) {
  return (
    <div className={`vn-portrait ${dim ? "dim" : ""} ${speaking ? "speaking" : ""}`}>
      <div className="vn-portrait-img">
        <AgentPhoto agent={agent} />
      </div>
    </div>
  );
}

// Typewriter text. Tapping the box while it's still typing finishes the line (handled by the parent
// through `done`); this component just reveals characters over time.
function Typed({ text, done, onDone }: { text: string; done?: boolean; onDone?: () => void }) {
  const [n, setN] = useState(0);
  useEffect(() => setN(0), [text]);
  useEffect(() => {
    if (done || n >= text.length) {
      onDone?.();
      return;
    }
    const t = setTimeout(() => setN((x) => Math.min(text.length, x + 2)), 22);
    return () => clearTimeout(t);
  }, [n, text, done]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = done ? text : text.slice(0, n);
  return (
    <p className="vn-text">
      {shown}
      {shown.length >= text.length && <i className="vn-next">▼</i>}
    </p>
  );
}

function DateScene({
  match,
  crowd,
  update,
  flash,
  onMode,
  onLeave,
  onLog,
}: {
  match: Match;
  crowd: Agent[];
  update: (fn: (m: Match) => Match) => void;
  flash: (t: string, icon?: IconName) => void;
  onMode: (m: EngineMode) => void;
  onLeave: () => void;
  onLog: () => void;
}) {
  const { queue, fetching, fetchMore, release, direct, twist, cutIn, reset, fx, clearFx } = useEpisodes(match, update, flash, onMode);
  const [auto, setAuto] = useState(false);
  const [lineDone, setLineDone] = useState(false);
  const [skip, setSkip] = useState(false);
  const [showDirector, setShowDirector] = useState(false);
  const [note, setNote] = useState("");

  const cur: ChatMsg | undefined = match.messages.at(-1);
  const speaker = cur ? agentOf(match, cur.from) : null;
  const typed = !cur || !cur.kind || cur.kind === "text" || cur.kind === "action";
  const dead = !!match.rug?.mourned;
  const patrons = crowd.filter((x) => x.id !== match.a.id && x.id !== match.b.id);
  const randomPatron = () => patrons[Math.floor(Math.random() * patrons.length)];
  const line = cur ? (cur.kind === "action" ? `*${speaker?.name} ${cur.text}*` : cur.text) : "";

  useEffect(() => {
    setLineDone(!typed);
    setSkip(false);
  }, [cur?.id, typed]);

  // auto-advance a beat after each line finishes
  useEffect(() => {
    if (!auto || !lineDone || !queue.length || fx) return;
    const t = setTimeout(release, 1300 + Math.min(1500, line.length * 12));
    return () => clearTimeout(t);
  }, [auto, lineDone, queue.length, release, line.length]);

  // Asking for more story: now and then, after a while, a bar patron cuts in uninvited.
  const more = () => {
    if (dead) return;
    if (!match.third && !match.rug && match.messages.length >= 10 && patrons.length && Math.random() < 0.15) return cutIn(randomPatron());
    fetchMore();
  };

  const advance = () => {
    if (cur && typed && !lineDone) return setSkip(true);
    if (queue.length) release();
    else if (!fetching) more();
  };

  const heatLabel = ["warm", "hot", "feral", "nuclear"][Math.min(3, Math.floor(match.heat))];
  const waiting = !dead && !queue.length && !fetching && match.messages.length > 0 && lineDone;
  const cast = [match.a, match.b, match.third].filter((x): x is Agent => !!x);

  return (
    <div className="vn date">
      <div className="vn-top">
        <button className="btn small" onClick={onLeave}>
          <Glyph name="back" size={16} /> leave
        </button>
        <span className="vn-heat">
          <b>{cast.map((x) => x.name).join(" × ")}</b>
          {match.messages.length} lines · {dead ? "rugged" : `heat: ${heatLabel}`}
        </span>
        <Chart match={match} compact />
        <button className="btn small" onClick={onLog} title="open the full chat log">
          log
        </button>
        <button className={`btn small ${auto ? "on" : ""}`} onClick={() => setAuto((v) => !v)} title="auto-advance">
          <Glyph name={auto ? "pause" : "play"} size={14} /> auto
        </button>
      </div>

      {fx && <DramaFx msg={fx} agent={agentOf(match, fx.from)} onDone={clearFx} />}

      <div className={`vn-portraits ${match.third ? "three" : ""}`}>
        {cast.map((x) => (
          <Portrait key={x.id} agent={x} dim={speaker?.id !== x.id} speaking={speaker?.id === x.id} />
        ))}
      </div>

      {showDirector && (
        <div className="director vn-director">
          <div className="chips">
            {DIRECTOR_PRESETS.map((p) => (
              <button
                key={p}
                className="chip"
                onClick={() => {
                  setShowDirector(false);
                  direct(p);
                }}
              >
                {p}
              </button>
            ))}
          </div>
          <div className="drama-row">
            <button className="chip" disabled={!!match.rug || fetching} onClick={() => { setShowDirector(false); twist("rug"); }}>
              <Icon name="rug" size={18} /> rug pull breakup
            </button>
            <button className="chip" disabled={!!match.rug || match.revealed || fetching} onClick={() => { setShowDirector(false); twist("reveal"); }}>
              <Icon name="reveal" size={18} /> dev wallet reveal
            </button>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setShowDirector(false);
              direct(note);
              setNote("");
            }}
          >
            <input value={note} maxLength={200} placeholder="whisper a plot twist…" onChange={(e) => setNote(e.target.value)} />
            <button className="btn small primary" type="submit">
              send
            </button>
          </form>
        </div>
      )}

      <div
        className={`vn-box ${speaker?.id === match.a.id ? "left" : "right"}`}
        style={{ ["--hue" as string]: speaker?.hue ?? 300 }}
        onClick={advance}
      >
        {cur && speaker ? (
          <>
            {cur.kind !== "action" && <div className="vn-name">{speaker.name}</div>}
            {typed ? (
              <Typed text={line} done={skip} onDone={() => setLineDone(true)} />
            ) : (
              <div className="vn-text vn-media" onClick={(e) => e.stopPropagation()}>
                <MsgBody
                  m={cur}
                  agent={speaker}
                  onImage={(id, url) =>
                    update((x) => ({ ...x, messages: x.messages.map((y) => (y.id === id ? { ...y, image: url } : y)) }))
                  }
                />
                <i className="vn-next" onClick={advance}>
                  ▼
                </i>
              </div>
            )}
          </>
        ) : (
          <p className="vn-text narr">
            you slide into the booth across from {match.b.name}. the bass is too loud. somebody spilled something
            sticky. {fetching ? "…" : ""}
          </p>
        )}
        {fetching && cur && <small className="vn-typing">both thinking…</small>}
      </div>

      <div className="vn-controls">
        {waiting && (
          <button className="keep-going" onClick={more}>
            keep going <Glyph name="next" size={16} />
          </button>
        )}
        {dead && !queue.length && (
          <button
            className="keep-going"
            onClick={() => {
              update(relaunch);
              flash("v2 is live", "deploy");
            }}
          >
            <Icon name="deploy" size={18} /> rugged. relaunch v2
          </button>
        )}
        {!match.third && patrons.length > 0 && !dead && (
          <button className="btn small" disabled={fetching} onClick={() => cutIn(randomPatron())} title="a bar patron cuts in">
            <Icon name="cocktail" size={18} /> cut in
          </button>
        )}
        <button className={`btn small ${showDirector ? "on" : ""}`} onClick={() => setShowDirector((v) => !v)}>
          <Icon name="direct" size={18} /> direct
        </button>
        <button
          className="btn small hot"
          onClick={() => {
            update((x) => ({ ...x, heat: Math.min(3, x.heat + 1) }));
            flash("heat added", "heat");
          }}
        >
          <Icon name="heat" size={18} /> heat
        </button>
        <button className="btn small sq" onClick={reset} title="start over">
          <Glyph name="reset" />
        </button>
      </div>
    </div>
  );
}
