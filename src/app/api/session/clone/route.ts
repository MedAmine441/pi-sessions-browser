import { NextResponse } from "next/server";
import { messageOf } from "@/lib/utils";
import { branchSessionAt, safeSessionPath } from "@/lib/pi-sessions";

/** The /clone counterpart: only the active branch survives into the copy. */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const safePath = await safeSessionPath(
      typeof body?.file === "string" ? body.file : null,
    );
    const file = await branchSessionAt(safePath);
    return NextResponse.json({ success: true, file });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: messageOf(error) || "Failed to clone session" },
      { status: 400 },
    );
  }
}
