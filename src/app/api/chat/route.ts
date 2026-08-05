import { NextResponse } from "next/server";
import { sendChatMessage, safeSessionPath } from "@/lib/pi-sessions";

export async function POST(request: Request) {
  try {
    const { file, message } = await request.json();
    if (!file || !message) return NextResponse.json({ error: "Missing file or message" }, { status: 400 });
    
    const safePath = await safeSessionPath(file);
    await sendChatMessage(safePath, message);
    
    return NextResponse.json({ success: true }, { status: 202 });
  } catch (error: any) {
    // Pi failing (usage limits, a bad key, a crash) is an outcome to report,
    // not a fault in this server, so it is logged as one line rather than a
    // stack trace that reads like the app fell over.
    console.warn(`Chat message not sent: ${error.message}`);
    return NextResponse.json({ error: error.message || "Failed to send chat message" }, { status: 500 });
  }
}
