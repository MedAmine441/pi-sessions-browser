import { NextResponse } from "next/server";
import { getLocations, getDefaultLocation } from "@/lib/pi-sessions";

export async function GET() {
  try {
    const locations = await getLocations();
    const defaultLocation = getDefaultLocation();
    return NextResponse.json({ locations, defaultLocation });
  } catch (error: any) {
    console.error(error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
