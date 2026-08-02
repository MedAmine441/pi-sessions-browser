import { NextResponse } from "next/server";
import { listDates } from "@/lib/pi-sessions";

export async function GET() {
  try {
    const dates = await listDates();
    return NextResponse.json(dates);
  } catch (error: any) {
    console.error(error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
