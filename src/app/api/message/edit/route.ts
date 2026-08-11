import { NextResponse } from "next/server";
import { editMessage, safeSessionPath, SessionEditError } from "@/lib/pi-sessions";

export async function POST(request: Request) {
  try {
    const { file, messageId, newText } = await request.json();
    if (!file || !messageId || typeof newText !== "string") {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const safePath = await safeSessionPath(file);
    await editMessage(safePath, messageId, newText);

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof SessionEditError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error(error);
    const message = error instanceof Error ? error.message : null;
    return NextResponse.json({ error: message || "Failed to edit message" }, { status: 500 });
  }
}
