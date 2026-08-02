import { NextResponse } from "next/server";
import { getConversation, safeSessionPath } from "@/lib/pi-sessions";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const file = await safeSessionPath(searchParams.get("file"));
    const conversation = await getConversation(file);
    return NextResponse.json(conversation);
  } catch (error: any) {
    console.error(error);
    return NextResponse.json({ error: error.message || "Failed to get session" }, { status: 400 });
  }
}
