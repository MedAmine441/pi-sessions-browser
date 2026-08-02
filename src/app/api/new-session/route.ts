import { NextResponse } from "next/server";
import { createNewSessionFile } from "@/lib/pi-sessions";

export async function POST(request: Request) {
  try {
    const file = await createNewSessionFile();
    return NextResponse.json({ success: true, file });
  } catch (error: any) {
    console.error(error);
    return NextResponse.json({ error: error.message || "Failed to launch new session" }, { status: 500 });
  }
}
