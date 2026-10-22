import type { Agent, Match } from "./types";

// v1 persistence is localStorage. A real backend would replace these four functions with
// calls to e.g. /api/agents and /api/matches (Postgres/Supabase), keyed by a wallet or session id.

const AGENTS = "gradient.agents.v1";
const MATCHES = "gradient.matches.v1";
const AGE_OK = "gradient.18plus";

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or blocked: app still works for this tab */
  }
}

export const loadAgents = () => read<Agent[]>(AGENTS, []);
export const saveAgents = (a: Agent[]) => write(AGENTS, a);
export const loadMatches = () => read<Match[]>(MATCHES, []);
export const saveMatches = (m: Match[]) => write(MATCHES, m.slice(0, 30));
export const ageOk = () => read<boolean>(AGE_OK, false);
export const setAgeOk = () => write(AGE_OK, true);

// Share links carry both agents in the URL hash, so no backend is needed to open a match.
export function encodeShare(a: Agent, b: Agent): string {
  // photos stay out of share links (too big for a URL); the other side sees the emoji avatar
  const json = JSON.stringify([a, b].map(({ photo: _photo, ...rest }) => rest));
  return btoa(unescape(encodeURIComponent(json))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeShare(s: string): [Agent, Agent] | null {
  try {
    const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
    const json = decodeURIComponent(escape(atob(b64)));
    const v = JSON.parse(json);
    if (!Array.isArray(v) || v.length !== 2) return null;
    // never trust a photo from a link: it skipped the photo filter
    return v.map(({ photo: _photo, ...rest }: Agent) => rest) as [Agent, Agent];
  } catch {
    return null;
  }
}

export const uid = () => Math.random().toString(36).slice(2, 10);
