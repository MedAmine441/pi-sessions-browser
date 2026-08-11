import { NextResponse } from "next/server";
import { messageOf } from "@/lib/utils";
import { logout } from "@/lib/pi-config";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    await logout(body?.provider);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: messageOf(error) }, { status: 400 });
  }
}
