import { NextResponse } from "next/server";
import { messageOf } from "@/lib/utils";
import { searchSessions } from "@/lib/pi-sessions";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get("q") || "";
    if (query.trim().length < 2)
      return NextResponse.json({ error: "Query too short" }, { status: 400 });
    const location = searchParams.get("location") || undefined;
    const results = await searchSessions(query, location);
    return NextResponse.json({ results });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: messageOf(error) || "Search failed" },
      { status: 500 },
    );
  }
}
