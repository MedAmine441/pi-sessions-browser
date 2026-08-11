import { NextResponse } from "next/server";
import { messageOf } from "@/lib/utils";
import { getPiState } from "@/lib/pi-config";

export async function GET() {
  try {
    return NextResponse.json(await getPiState());
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: messageOf(error) }, { status: 500 });
  }
}
