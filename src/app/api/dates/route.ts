import { NextResponse } from "next/server";
import { messageOf } from "@/lib/utils";
import { listDates } from "@/lib/pi-sessions";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const location = searchParams.get("location") || undefined;
    const dates = await listDates(location);
    return NextResponse.json(dates);
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: messageOf(error) }, { status: 500 });
  }
}
