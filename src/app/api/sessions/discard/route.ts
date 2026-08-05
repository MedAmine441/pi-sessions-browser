import { NextResponse } from "next/server";
import { discardIfEmpty, safeSessionPath } from "@/lib/pi-sessions";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    if (typeof body?.file !== "string" || !body.file)
      return NextResponse.json({ error: "Missing file parameter" }, { status: 400 });

    const safePath = await safeSessionPath(body.file);
    return NextResponse.json({ discarded: await discardIfEmpty(safePath) });
  } catch (error: any) {
    console.error(error);
    return NextResponse.json(
      { error: error.message || "Failed to discard session" },
      { status: 500 },
    );
  }
}
