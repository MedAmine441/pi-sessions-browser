import { NextResponse } from "next/server";
import { messageOf } from "@/lib/utils";
import { createNewSessionFile } from "@/lib/pi-sessions";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const cwd = typeof body?.cwd === "string" && body.cwd ? body.cwd : undefined;
    const file = await createNewSessionFile(cwd);
    return NextResponse.json({ success: true, file });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: messageOf(error) || "Failed to launch new session" }, { status: 500 });
  }
}
