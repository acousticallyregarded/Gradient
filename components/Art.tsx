"use client";

import { useEffect, useState } from "react";
import { agentGallery, artUrl, avatarArt, type IconName, type SceneName } from "@/lib/art";
import type { Agent } from "@/lib/types";

// The static demo build has no server, so it never asks for generated art and shows the fallbacks.
const isStatic = typeof window !== "undefined" && !!(window as unknown as { __GRADIENT_STATIC__?: boolean }).__GRADIENT_STATIC__;
const RETRIES = 6;

// A generated picture from /api/art. The first visitor to need one may wait while it is made (or get a
// "busy, retry" while others are being made), so it retries a few times before giving up quietly.
export function Art({
  name,
  className = "",
  alt = "",
  fallback = null,
  onReady,
  onFail,
}: {
  name: string;
  className?: string;
  alt?: string;
  fallback?: React.ReactNode;
  onReady?: (ok: boolean) => void;
  onFail?: () => void;
}) {
  const [tries, setTries] = useState(0);
  const [state, setState] = useState<"loading" | "ok" | "fail">(isStatic ? "fail" : "loading");
  const [wait, setWait] = useState(false);

  useEffect(() => {
    setTries(0);
    setWait(false);
    setState(isStatic ? "fail" : "loading");
  }, [name]);

  useEffect(() => {
    if (!wait) return;
    const t = setTimeout(() => {
      setWait(false);
      setTries((n) => n + 1);
    }, 5000 + tries * 4000);
    return () => clearTimeout(t);
  }, [wait, tries]);

  useEffect(() => {
    onReady?.(state === "ok");
    if (state === "fail") onFail?.();
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

  if (state === "fail") return <>{fallback}</>;
  return (
    <>
      {state === "loading" && fallback}
      {!wait && (
        <img
          key={tries}
          className={`art ${state === "ok" ? "in" : ""} ${className}`}
          src={artUrl(name) + (tries ? `&r=${tries}` : "")}
          alt={alt}
          draggable={false}
          decoding="async"
          onLoad={() => setState("ok")}
          onError={() => (tries + 1 >= RETRIES ? setState("fail") : setWait(true))}
        />
      )}
    </>
  );
}

// Small generated icon used where emojis used to be. Takes up its space while loading; hides if it never arrives.
export function Icon({ name, size = 20, className = "" }: { name: IconName; size?: number; className?: string }) {
  return (
    <span className={`ico ${className}`} style={{ width: size, height: size }} aria-hidden="true">
      <Art name={`icon-${name}`} />
    </span>
  );
}

export function Scene({ name, size = 160, className = "" }: { name: SceneName; size?: number; className?: string }) {
  return (
    <span className={`scene ${className}`} style={{ width: size, height: size }} aria-hidden="true">
      <Art name={`scene-${name}`} />
    </span>
  );
}

const initials = (name: string) =>
  (name.replace(/[^A-Za-z0-9 ]/g, " ").trim().split(/\s+|(?=[A-Z][a-z])/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("") || "?").toUpperCase();

export const agentGradient = (hue: number) =>
  `radial-gradient(120% 90% at 30% 15%, hsl(${hue} 55% 52%), hsl(${(hue + 30) % 360} 50% 30%) 55%, hsl(${(hue + 40) % 360} 40% 14%))`;

// An agent's picture filling its box: their uploaded photo, else a generated portrait, else a monogram.
export function AgentPhoto({ agent, className = "" }: { agent: Pick<Agent, "id" | "name" | "emoji" | "hue" | "photo">; className?: string }) {
  const art = agent.photo ? null : avatarArt(agent);
  const mono = (
    <span className="monogram" style={{ background: agentGradient(agent.hue) }}>
      <span>{initials(agent.name)}</span>
    </span>
  );
  return (
    <span className={`agent-photo ${className}`}>
      {agent.photo ? <img className="art in" src={agent.photo} alt="" draggable={false} /> : art ? <Art name={art} fallback={mono} /> : mono}
    </span>
  );
}

// A profile's camera roll: every photo stacked (so they're all loaded), the current one shown, with
// story-style bars on top. Taps are handled by the parent (the swipe card needs to tell taps from drags),
// or by the left/right tap zones when `tappable`.
export function AgentGallery({
  agent,
  className = "",
  index,
  onIndex,
  tappable,
}: {
  agent: Pick<Agent, "id" | "name" | "emoji" | "hue" | "photo">;
  className?: string;
  index?: number;
  onIndex?: (i: number) => void;
  tappable?: boolean;
}) {
  const [own, setOwn] = useState(0);
  const [dead, setDead] = useState<string[]>([]);
  const all = agent.photo ? [] : agentGallery(agent);
  const shots = all.filter((n, i) => i === 0 || !dead.includes(n));
  if (shots.length <= 1) return <AgentPhoto agent={agent} className={className} />;
  const cur = Math.min(index ?? own, shots.length - 1);
  const go = (i: number) => {
    const next = (i + shots.length) % shots.length;
    setOwn(next);
    onIndex?.(next);
  };
  return (
    <span className={`agent-photo gallery ${className}`}>
      {shots.map((n, i) =>
        i === 0 ? (
          <span key={n} className={`slide ${i === cur ? "on" : ""}`}>
            <AgentPhoto agent={agent} />
          </span>
        ) : (
          <span key={n} className={`slide ${i === cur ? "on" : ""}`}>
            <Art name={n} onFail={() => setDead((d) => [...d, n])} />
          </span>
        ),
      )}
      <span className="gallery-bars">
        {shots.map((n, i) => (
          <i key={n} className={i === cur ? "on" : ""} />
        ))}
      </span>
      {tappable && (
        <>
          <button className="gallery-tap prev" aria-label="previous photo" onClick={() => go(cur - 1)} />
          <button className="gallery-tap next" aria-label="next photo" onClick={() => go(cur + 1)} />
        </>
      )}
    </span>
  );
}

export const galleryLength = (agent: Pick<Agent, "id" | "emoji" | "photo">) => (agent.photo ? 1 : Math.max(1, agentGallery(agent).length));

// Plain interface glyphs (back, play, close...). These are controls, not decoration, so they stay crisp SVG.
const PATHS: Record<string, string> = {
  back: "M15 5l-7 7 7 7",
  next: "M9 5l7 7-7 7",
  close: "M6 6l12 12M18 6L6 18",
  play: "M8 5.5v13l11-6.5z",
  pause: "M8 5v14M16 5v14",
  reset: "M4 12a8 8 0 1 0 2.4-5.7M4 4v4h4",
  share: "M12 15V4M7.5 8.5L12 4l4.5 4.5M5 13v6h14v-6",
  plus: "M12 5v14M5 12h14",
  grid: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  cards: "M7 4h10a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM2 7v10M22 7v10",
  check: "M5 12.5l4.5 4.5L19 7",
  down: "M6 9l6 6 6-6",
  heart: "M12 20.5s-7.5-4.6-7.5-10.1A4.3 4.3 0 0 1 12 7.6a4.3 4.3 0 0 1 7.5 2.8c0 5.5-7.5 10.1-7.5 10.1z",
  sun: "M12 4V2M12 22v-2M4 12H2M22 12h-2M5.6 5.6L4.2 4.2M19.8 19.8l-1.4-1.4M5.6 18.4l-1.4 1.4M19.8 4.2l-1.4 1.4M12 16.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9z",
  moon: "M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z",
};

export function Glyph({ name, size = 18, className = "" }: { name: keyof typeof PATHS; size?: number; className?: string }) {
  const filled = name === "play" || name === "heart";
  return (
    <svg
      className={`glyph ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={filled ? 0 : 2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

// The blue verified tick.
export function Verified({ size = 15 }: { size?: number }) {
  return (
    <svg className="verified" width={size} height={size} viewBox="0 0 24 24" aria-label="verified">
      <path
        fill="#3d9bff"
        d="M12 1.5l2.6 1.9 3.2-.2 1 3 2.6 1.9-1 3.1 1 3.1-2.6 1.9-1 3-3.2-.2L12 22.5l-2.6-1.9-3.2.2-1-3-2.6-1.9 1-3.1-1-3.1 2.6-1.9 1-3 3.2.2z"
      />
      <path d="M7.8 12.3l2.8 2.8 5.6-5.8" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
