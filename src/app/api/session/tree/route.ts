import { NextResponse } from "next/server";
import { messageOf } from "@/lib/utils";
import { getSessionTree, safeSessionPath } from "@/lib/pi-sessions";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const safePath = await safeSessionPath(searchParams.get("file"));
    return NextResponse.json(await getSessionTree(safePath));
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: messageOf(error) || "Failed to read session tree" },
      { status: 400 },
    );
  }
}
