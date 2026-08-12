import { NextResponse } from "next/server";
import { messageOf } from "@/lib/utils";
import { safeSessionPath } from "@/lib/pi-sessions";
import { getRpcSession } from "@/lib/pi-rpc";

/** Pi's ImageContent: base64 data plus its mime type. */
type ImagePayload = { type: "image"; data: string; mimeType: string };

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

/**
 * Shapes the request's images into pi's ImageContent, refusing anything
 * that is not a plausible base64 image payload.
 */
function imagesFrom(raw: unknown): ImagePayload[] | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!Array.isArray(raw)) throw new Error("images must be an array.");
  let total = 0;
  const images = (raw as { data?: unknown; mimeType?: unknown }[]).map((entry) => {
    if (
      typeof entry?.data !== "string" ||
      !entry.data ||
      typeof entry?.mimeType !== "string" ||
      !entry.mimeType.startsWith("image/")
    )
      throw new Error("Each image needs base64 data and an image/* mime type.");
    total += entry.data.length;
    return { type: "image" as const, data: entry.data, mimeType: entry.mimeType };
  });
  if (total > MAX_IMAGE_BYTES)
    throw new Error("Attached images are larger than the 20 MB limit.");
  return images.length ? images : undefined;
}

/**
 * Send a prompt through the session's persistent RPC process, spawning it
 * on first use. If pi is mid-stream it rejects a bare prompt, so the retry
 * queues the message as a follow-up — pi delivers it once the run settles.
 */
export async function POST(request: Request) {
  try {
    const { file, message, images: rawImages } = await request.json();
    if (typeof message !== "string" || !message.trim())
      return NextResponse.json({ error: "A message is required." }, { status: 400 });
    let images: ImagePayload[] | undefined;
    try {
      images = imagesFrom(rawImages);
    } catch (error) {
      return NextResponse.json({ error: messageOf(error) }, { status: 400 });
    }
    const safePath = await safeSessionPath(file);
    const session = await getRpcSession(safePath, true);
    if (!session)
      return NextResponse.json({ error: "Could not start pi." }, { status: 500 });
    try {
      await session.send({ type: "prompt", message, images });
      return NextResponse.json({ ok: true, queued: false });
    } catch (error) {
      if (!/stream/i.test(messageOf(error))) throw error;
      await session.send({
        type: "prompt",
        message,
        images,
        streamingBehavior: "followUp",
      });
      return NextResponse.json({ ok: true, queued: true });
    }
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: messageOf(error) }, { status: 500 });
  }
}
