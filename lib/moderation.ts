import Anthropic from "@anthropic-ai/sdk";
import { MODERATION_PROMPT } from "./photo";

const MODEL = process.env.GRADIENT_MODEL || "claude-opus-5-5";

export type ModerationResult = { allowed: boolean; reason: string } | { error: "no_key" | "bad_image" | "failed" };

// Claude vision as the profile-photo filter. Fails closed: anything but a clear "allowed" is a no.
export async function moderateImage(image: string | undefined): Promise<ModerationResult> {
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) return { error: "no_key" };
  const m = /^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(image ?? "");
  if (!m || m[2].length > 400_000) return { error: "bad_image" };
  try {
    const client = new Anthropic();
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 2000,
      output_config: { effort: "low" },
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: m[1] as "image/jpeg", data: m[2] } },
            { type: "text", text: MODERATION_PROMPT },
          ],
        },
      ],
    });
    if (response.stop_reason === "refusal") return { allowed: false, reason: "not allowed" };
    const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    const json = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
    return { allowed: json.allowed === true, reason: String(json.reason ?? "") };
  } catch (err) {
    if (err instanceof Anthropic.APIError) console.error("moderation error", err.status, err.message);
    else console.error(err);
    return { error: "failed" };
  }
}
