import { NextResponse } from "next/server";
import { listDirectories } from "@/lib/pi-sessions";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const path = searchParams.get("path") || undefined;
    return NextResponse.json(await listDirectories(path));
  } catch (error: any) {
    console.error(error);
    return NextResponse.json(
      { error: error.message || "Failed to read that folder" },
      { status: 500 },
    );
  }
}
