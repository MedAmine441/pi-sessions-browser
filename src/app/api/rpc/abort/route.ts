import { NextResponse } from "next/server";
import { messageOf } from "@/lib/utils";
import { safeSessionPath } from "@/lib/pi-sessions";
import { getRpcSession } from "@/lib/pi-rpc";

/** The Stop button: abort whatever pi is doing in this session right now. */
export async function POST(request: Request) {
  try {
    const { file } = await request.json();
    const safePath = await safeSessionPath(file);
    const session = await getRpcSession(safePath);
    if (!session)
      return NextResponse.json({ error: "Nothing is running." }, { status: 409 });
    await session.send({ type: "abort" });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: messageOf(error) }, { status: 500 });
  }
}
