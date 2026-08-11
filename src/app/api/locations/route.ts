import { NextResponse } from "next/server";
import { messageOf } from "@/lib/utils";
import { getLocations, getDefaultLocation } from "@/lib/pi-sessions";

export async function GET() {
  try {
    const locations = await getLocations();
    const defaultLocation = getDefaultLocation();
    return NextResponse.json({ locations, defaultLocation });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: messageOf(error) }, { status: 500 });
  }
}
