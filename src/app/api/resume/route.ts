import { NextResponse } from "next/server";
import { launchSession, safeSessionPath } from "@/lib/pi-sessions";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const file = await safeSessionPath(body.file);
    await launchSession(file);
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error(error);
    return NextResponse.json({ error: error.message || "Failed to resume session" }, { status: 400 });
  }
}
