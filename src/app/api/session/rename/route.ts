import { NextResponse } from "next/server";
import { messageOf } from "@/lib/utils";
import { renameSession, safeSessionPath } from "@/lib/pi-sessions";

export async function POST(request: Request) {
  try {
    const { file, name } = await request.json();
    if (!file || typeof name !== "string") return NextResponse.json({ error: "Missing file or name" }, { status: 400 });
    
    const safePath = await safeSessionPath(file);
    await renameSession(safePath, name);
    
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: messageOf(error) || "Failed to rename session" }, { status: 500 });
  }
}
