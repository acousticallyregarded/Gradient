"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { canAutoFetch, engineMode, nextEpisode, type EngineMode } from "@/lib/engine";
import { applyMsg, planTwist, toChatMsgs, type Twist } from "@/lib/drama";
import type { Agent, ChatMsg, Match } from "@/lib/types";
import type { IconName } from "@/lib/art";

// Same batching as the inbox chat: fetch an episode, buffer it, hand messages out one at a time.
// The date scene decides when to release the next one (tap, or auto after the line finishes).
export function useEpisodes(
  match: Match,
  update: (fn: (m: Match) => Match) => void,
  flash: (t: string, icon?: IconName) => void,
  onMode: (m: EngineMode) => void,
) {
  const [queue, setQueue] = useState<ChatMsg[]>([]);
  const [fetching, setFetching] = useState(false);
  const [fx, setFx] = useState<ChatMsg | null>(null);
  const fetchingRef = useRef(false);
  const matchRef = useRef(match);
  matchRef.current = match;
  const n = match.messages.length;

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

  // A fresh date opens with a batch, and so does getting rugged (the monologue follows right away);
  // otherwise new batches wait for a tap like the inbox.
  const mourning = !!match.rug && !match.rug.mourned;
  useEffect(() => {
    if (queue.length || fetching || fx) return;
    if (n === 0 || canAutoFetch() || mourning) fetchMore();
  }, [queue.length, fetching, n, fetchMore, mourning, fx]);

  const release = useCallback(() => {
    setQueue((q) => {
      if (!q.length) return q;
      const [head, ...rest] = q;
      update((x) => applyMsg(x, head));
      if (head.kind === "rug" || head.kind === "reveal") {
        setFx(head);
        if (head.kind === "rug") return [];
      }
      return rest;
    });
  }, [update]);

  const direct = (note: string) => {
    const t = note.trim();
    if (!t) return;
    setQueue([]);
    flash("noted", "direct");
    fetchMore(t);
  };

  const twist = (kind: "rug" | "reveal") => {
    if (matchRef.current.rug || fetchingRef.current) return;
    setQueue([]);
    flash(kind === "rug" ? "somebody's getting cold feet…" : "someone has a secret…", kind === "rug" ? "rug" : "reveal");
    fetchMore(undefined, kind);
  };

  // A bar patron (or anyone) cuts in: threesome mode from here on.
  const cutIn = (c: Agent) => {
    if (fetchingRef.current) return;
    setQueue([]);
    update((x) => ({ ...x, third: c }));
    flash(`${c.name} cut in`, "cocktail");
    fetchMore(undefined, undefined, c);
  };

  const reset = () => {
    setQueue([]);
    update((x) => ({ ...x, messages: [], heat: 0, summary: undefined, rug: undefined, revealed: undefined, third: undefined }));
  };

  return { queue, fetching, fetchMore, release, direct, twist, cutIn, reset, fx, clearFx: () => setFx(null) };
}
