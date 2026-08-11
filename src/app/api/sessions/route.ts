import { NextResponse } from "next/server";
import { messageOf } from "@/lib/utils";
import { listSessions, safeSessionPath, deleteSession } from "@/lib/pi-sessions";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const date = searchParams.get("date") || undefined;
    const location = searchParams.get("location") || undefined;
    const sessions = await listSessions(date, location);
    return NextResponse.json(sessions);
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: messageOf(error) || "Failed to list sessions" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const file = searchParams.get("file");
    if (!file) return NextResponse.json({ error: "Missing file parameter" }, { status: 400 });
    
    const safePath = await safeSessionPath(file);
    await deleteSession(safePath);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: messageOf(error) || "Failed to delete session" }, { status: 500 });
  }
}
