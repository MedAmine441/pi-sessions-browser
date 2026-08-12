import { NextResponse } from "next/server";
import { listSessions } from "@/lib/pi-sessions";
import { aggregateStats } from "@/lib/stats";
import { messageOf } from "@/lib/utils";

/**
 * Usage rolled up across every session (optionally scoped to one folder).
 * Summaries come from the same (size, mtime)-keyed cache the listings use,
 * so only new or changed files are re-read.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const location = searchParams.get("location") || undefined;
    const sessions = await listSessions(undefined, location);
    return NextResponse.json(aggregateStats(sessions));
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: messageOf(error) }, { status: 500 });
  }
}
