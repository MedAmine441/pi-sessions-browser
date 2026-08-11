import { NextResponse } from "next/server";
import { messageOf } from "@/lib/utils";
import { safeSessionPath } from "@/lib/pi-sessions";
import { closeRpcSession } from "@/lib/pi-rpc";

/** Closing a chat retires its pi process instead of waiting out the idle timer. */
export async function POST(request: Request) {
  try {
    const { file } = await request.json();
    closeRpcSession(await safeSessionPath(file));
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: messageOf(error) }, { status: 500 });
  }
}
