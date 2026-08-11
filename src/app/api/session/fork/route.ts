import { NextResponse } from "next/server";
import { messageOf } from "@/lib/utils";
import { forkSession, safeSessionPath } from "@/lib/pi-sessions";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const safePath = await safeSessionPath(
      typeof body?.file === "string" ? body.file : null,
    );
    const file = await forkSession(safePath);
    return NextResponse.json({ success: true, file });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: messageOf(error) || "Failed to fork session" },
      { status: 400 },
    );
  }
}
