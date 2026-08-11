import { NextResponse } from "next/server";
import { messageOf } from "@/lib/utils";
import { listDirectories } from "@/lib/pi-sessions";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const path = searchParams.get("path") || undefined;
    return NextResponse.json(await listDirectories(path));
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: messageOf(error) || "Failed to read that folder" },
      { status: 500 },
    );
  }
}
