import { NextResponse } from "next/server";
import { editMessage, safeSessionPath } from "@/lib/pi-sessions";

export async function POST(request: Request) {
  try {
    const { file, messageId, newText } = await request.json();
    if (!file || !messageId || typeof newText !== "string") {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }
    
    const safePath = await safeSessionPath(file);
    await editMessage(safePath, messageId, newText);
    
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error(error);
    return NextResponse.json({ error: error.message || "Failed to edit message" }, { status: 500 });
  }
}
