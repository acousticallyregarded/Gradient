// Agent photos: resized client-side to a small square JPEG data URL (fits in localStorage),
// then checked by Claude vision before they're accepted. No check available = no upload.

export const MODERATION_PROMPT = `You are the photo filter for Gradient, a cheeky 18+ dating-app parody. Decide whether this image may be used as a profile picture.

ALLOW: selfies, faces, shirtless or swimwear/underwear photos, gym pics, suggestive-but-covered poses, memes, cartoons, drawings, objects, animals, crypto charts.
BLOCK: visible genitals or fully exposed buttocks, sexual acts, sex toys in use, anyone who could be under 18, gore, hate symbols, or a screenshot that shows someone's private info.

Reply with only JSON: {"allowed": true|false, "reason": "a few words, shown to the user if blocked"}`;

export async function resizePhoto(file: File, size = 256): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("not an image"));
      i.src = url;
    });
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    // center-crop to a square, like a Grindr tile
    ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, size, size);
    return canvas.toDataURL("image/jpeg", 0.78);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const [head, b64] = dataUrl.split(",");
  const mime = /data:(.*?);/.exec(head)?.[1] ?? "image/jpeg";
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export type Verdict = { allowed: boolean; reason: string } | { unavailable: true; reason: string };

type SampleFn = { json: (input: string, opts?: Record<string, unknown>) => Promise<unknown> };

export async function checkPhoto(dataUrl: string): Promise<Verdict> {
  const w = window as unknown as { __GRADIENT_STATIC__?: boolean; claude?: { use: (n: string) => Promise<unknown> } };
  if (w.__GRADIENT_STATIC__) {
    const sample = (await w.claude?.use("sample").catch(() => null)) as SampleFn | null;
    if (!sample) return { unavailable: true, reason: "photo uploads need live mode" };
    try {
      const v = (await sample.json(MODERATION_PROMPT, { images: [dataUrlToBlob(dataUrl)], cache: false })) as {
        allowed?: boolean;
        reason?: string;
      };
      return { allowed: v?.allowed === true, reason: v?.reason ?? "" };
    } catch (e) {
      return { unavailable: true, reason: (e as { code?: string }).code === "not_granted" ? "allow Claude to check photos" : "photo check failed, try again" };
    }
  }
  try {
    const res = await fetch("/api/moderate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ image: dataUrl }),
    });
    const v = await res.json();
    if (typeof v.allowed === "boolean") return { allowed: v.allowed, reason: v.reason ?? "" };
    return { unavailable: true, reason: v.reason === "no_key" ? "photo uploads need live mode" : "photo check failed, try again" };
  } catch {
    return { unavailable: true, reason: "photo check failed, try again" };
  }
}
