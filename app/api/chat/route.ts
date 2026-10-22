import Anthropic from "@anthropic-ai/sdk";
import { buildEpisodePrompt, parseEpisode, type EpisodeRequest } from "@/lib/prompt";

export const runtime = "nodejs";

const MODEL = process.env.GRADIENT_MODEL || "claude-opus-5-5";

// Returns { messages, summary } (the next stretch of the chat), or { fallback: true, reason }
// so the client drops to the offline stub engine.
export async function POST(req: Request) {
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    return Response.json({ fallback: true, reason: "no_key" }, { status: 503 });
  }

  const body = (await req.json()) as EpisodeRequest;

  try {
    const client = new Anthropic();
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 8000,
      output_config: { effort: "low" },
      messages: [{ role: "user", content: buildEpisodePrompt(body) }],
    });

    if (response.stop_reason === "refusal") {
      return Response.json({ fallback: true, reason: "refusal" });
    }
    const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    const episode = parseEpisode(text);
    if (!episode) return Response.json({ fallback: true, reason: "unparseable" });
    return Response.json(episode);
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) {
      return Response.json({ fallback: true, reason: "rate_limited" });
    }
    if (err instanceof Anthropic.APIError) {
      console.error("Claude API error", err.status, err.message);
      return Response.json({ fallback: true, reason: `api_${err.status ?? "error"}` });
    }
    console.error(err);
    return Response.json({ fallback: true, reason: "error" });
  }
}
