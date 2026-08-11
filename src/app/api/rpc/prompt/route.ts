import { NextResponse } from "next/server";
import { messageOf } from "@/lib/utils";
import { safeSessionPath } from "@/lib/pi-sessions";
import { getRpcSession } from "@/lib/pi-rpc";

/**
 * Send a prompt through the session's persistent RPC process, spawning it
 * on first use. If pi is mid-stream it rejects a bare prompt, so the retry
 * queues the message as a follow-up — pi delivers it once the run settles.
 */
export async function POST(request: Request) {
  try {
    const { file, message } = await request.json();
    if (typeof message !== "string" || !message.trim())
      return NextResponse.json({ error: "A message is required." }, { status: 400 });
    const safePath = await safeSessionPath(file);
    const session = await getRpcSession(safePath, true);
    if (!session)
      return NextResponse.json({ error: "Could not start pi." }, { status: 500 });
    try {
      await session.send({ type: "prompt", message });
      return NextResponse.json({ ok: true, queued: false });
    } catch (error) {
      if (!/stream/i.test(messageOf(error))) throw error;
      await session.send({
        type: "prompt",
        message,
        streamingBehavior: "followUp",
      });
      return NextResponse.json({ ok: true, queued: true });
    }
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: messageOf(error) }, { status: 500 });
  }
}
