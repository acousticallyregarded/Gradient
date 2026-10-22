"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { canAutoFetch, engineMode, nextEpisode, type EngineMode } from "@/lib/engine";
import { uid } from "@/lib/storage";
import type { ChatMsg, Match } from "@/lib/types";

// Same batching as the inbox chat: fetch an episode, buffer it, hand messages out one at a time.
// The date scene decides when to release the next one (tap, or auto after the line finishes).
export function useEpisodes(
  match: Match,
  update: (fn: (m: Match) => Match) => void,
  flash: (t: string) => void,
  onMode: (m: EngineMode) => void,
) {
  const [queue, setQueue] = useState<ChatMsg[]>([]);
  const [fetching, setFetching] = useState(false);
  const fetchingRef = useRef(false);
  const matchRef = useRef(match);
  matchRef.current = match;
  const n = match.messages.length;

  const fetchMore = useCallback(
    async (note?: string) => {
      if (fetchingRef.current) return;
      fetchingRef.current = true;
      setFetching(true);
      const m = matchRef.current;
      try {
        const ep = await nextEpisode({
          a: m.a,
          b: m.b,
          history: m.messages,
          summary: m.summary,
          heat: m.heat,
          director: note,
        });
        const msgs: ChatMsg[] = ep.messages.map((x) => ({
          id: uid(),
          from: x.from === "A" ? m.a.id : m.b.id,
          kind: x.kind,
          text: x.text,
          ...(x.scene ? { scene: x.scene } : {}),
          source: ep.source,
        }));
        if (ep.summary) update((x) => ({ ...x, summary: ep.summary }));
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

  // A fresh date opens with a batch; after that, new batches wait for a tap like the inbox.
  useEffect(() => {
    if (queue.length || fetching) return;
    if (n === 0 || canAutoFetch()) fetchMore();
  }, [queue.length, fetching, n, fetchMore]);

  const release = useCallback(() => {
    setQueue((q) => {
      if (!q.length) return q;
      const [head, ...rest] = q;
      update((x) => ({ ...x, messages: [...x.messages, head] }));
      return rest;
    });
  }, [update]);

  const direct = (note: string) => {
    const t = note.trim();
    if (!t) return;
    setQueue([]);
    flash("🎬 noted");
    fetchMore(t);
  };

  const reset = () => {
    setQueue([]);
    update((x) => ({ ...x, messages: [], heat: 0, summary: undefined }));
  };

  return { queue, fetching, fetchMore, release, direct, reset };
}
