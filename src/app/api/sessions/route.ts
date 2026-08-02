import { NextResponse } from "next/server";
import { listSessions, safeSessionPath, deleteSession } from "@/lib/pi-sessions";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const date = searchParams.get("date") || undefined;
    const sessions = await listSessions(date);
    return NextResponse.json(sessions);
  } catch (error: any) {
    console.error(error);
    return NextResponse.json({ error: error.message || "Failed to list sessions" }, { status: 500 });
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
  } catch (error: any) {
    console.error(error);
    return NextResponse.json({ error: error.message || "Failed to delete session" }, { status: 500 });
  }
}
