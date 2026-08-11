import { NextResponse } from "next/server";
import { messageOf } from "@/lib/utils";
import { safeSessionPath } from "@/lib/pi-sessions";
import { runPiRpc } from "@/lib/pi-rpc";

/**
 * The /compact counterpart: pi itself summarizes the older context and
 * appends the compaction entry (via RPC), so the result is exactly what the
 * terminal's /compact would produce. The SSE stream picks the new entry up.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const safePath = await safeSessionPath(
      typeof body?.file === "string" ? body.file : null,
    );
    const customInstructions =
      typeof body?.customInstructions === "string" && body.customInstructions.trim()
        ? body.customInstructions.trim()
        : undefined;

    const data = await runPiRpc(safePath, { type: "compact", customInstructions });
    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: messageOf(error) || "Failed to compact session" },
      { status: 500 },
    );
  }
}
