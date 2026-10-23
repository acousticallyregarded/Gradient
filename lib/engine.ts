import { buildEpisodePrompt, enforceTwist, normalizeEpisode, type Episode, type EpisodeRequest } from "./prompt";
import { stubEpisode } from "./stub";

// Three ways to get the next stretch of chat, tried in order:
//  "server": the Next.js /api/chat route with ANTHROPIC_API_KEY (the real deployment)
//  "sample": the viewer's own Claude account, when the static demo runs inside a Claude artifact
//  "stub":   the offline generator, always available
export type EngineMode = "unknown" | "server" | "sample" | "stub";

type SampleFn = { json: (input: string, opts?: Record<string, unknown>) => Promise<unknown> };
type ClaudeRuntime = { use: (name: string) => Promise<unknown> };

const w = (typeof window !== "undefined" ? window : {}) as {
  __GRADIENT_STATIC__?: boolean;
  claude?: ClaudeRuntime;
};

let mode: EngineMode = "unknown";
let samplePromise: Promise<SampleFn | null> | null = null;
let sampleDenied = false;

export const engineMode = () => mode;

function getSample(): Promise<SampleFn | null> {
  if (!w.claude?.use) return Promise.resolve(null);
  samplePromise ??= w.claude.use("sample").then((s) => (s as SampleFn) ?? null).catch(() => null);
  return samplePromise;
}

// Probe once at startup so the UI can label itself before the first chat.
export async function detectMode(): Promise<EngineMode> {
  if (mode !== "unknown") return mode;
  if (w.__GRADIENT_STATIC__) {
    mode = (await getSample()) ? "sample" : "stub";
    return mode;
  }
  return mode; // server mode is confirmed by the first successful call
}

// Whether a new batch may be requested without an explicit tap. Never, after the opening batch:
// every batch costs a model call, so viewers tap "keep going" to pay for more story.
export const canAutoFetch = () => false;

export async function nextEpisode(req: EpisodeRequest): Promise<Episode & { source: "claude" | "stub"; note?: string }> {
  if (w.__GRADIENT_STATIC__) {
    const sample = sampleDenied ? null : await getSample();
    if (sample) {
      try {
        const raw = await sample.json(buildEpisodePrompt(req), { cache: false, modelTier: "default" });
        const ep = normalizeEpisode(raw, !!req.c);
        if (ep) {
          mode = "sample";
          return { ...enforceTwist(ep, req.twist), source: "claude" };
        }
      } catch (e) {
        const code = (e as { code?: string }).code;
        if (code === "not_granted" || code === "sampling_disabled") {
          sampleDenied = true;
          mode = "stub";
        }
        await pause(400);
        return { ...stubEpisode(req), source: "stub", note: code };
      }
    }
  } else if (mode !== "stub") {
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(req),
      });
      const data = await res.json();
      if (Array.isArray(data.messages)) {
        mode = "server";
        return { ...(data as Episode), source: "claude" };
      }
      if (data.reason === "no_key") mode = "stub";
    } catch {
      mode = "stub";
    }
  }
  if (mode === "unknown") mode = "stub";
  await pause(400);
  return { ...stubEpisode(req), source: "stub" };
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
