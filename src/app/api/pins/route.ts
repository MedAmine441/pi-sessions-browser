import { NextResponse } from "next/server";
import { messageOf } from "@/lib/utils";
import { getPinned, setPinned } from "@/lib/browser-state";
import { getSessionInfos, safeSessionPath } from "@/lib/pi-sessions";

/** The pinned files plus their summaries, for the sidebar and the grid. */
export async function GET() {
  try {
    const pinned = await getPinned();
    const sessions = await getSessionInfos(pinned);
    return NextResponse.json({ pinned, sessions });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: messageOf(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { file, pinned } = await request.json();
    const safePath = await safeSessionPath(file);
    const kept = await setPinned(safePath, pinned === true);
    return NextResponse.json({ pinned: kept });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: messageOf(error) }, { status: 400 });
  }
}
