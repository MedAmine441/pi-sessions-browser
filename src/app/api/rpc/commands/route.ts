import { NextResponse } from "next/server";
import { messageOf } from "@/lib/utils";
import { safeSessionPath } from "@/lib/pi-sessions";
import { getRpcSession } from "@/lib/pi-rpc";

/** What pi's get_commands returns per command. */
type PiCommandList = {
  commands?: { name?: string; description?: string; source?: string }[];
};

/**
 * The slash commands pi itself would accept in this session — extension
 * commands, prompt templates, and skills. Spawns the session's RPC process
 * if none is up yet: whoever is typing "/" is about to need it anyway, and
 * a pre-warmed pi makes the first prompt instant.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const safePath = await safeSessionPath(searchParams.get("file"));
    const session = await getRpcSession(safePath, true);
    if (!session)
      return NextResponse.json({ error: "Could not start pi." }, { status: 500 });
    const data = await session.send<PiCommandList>({ type: "get_commands" });
    const commands = (data?.commands || [])
      .filter((command) => typeof command?.name === "string" && command.name)
      .map((command) => ({
        name: command.name as string,
        description: command.description || "",
        source: command.source || "extension",
      }));
    return NextResponse.json({ commands });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: messageOf(error) }, { status: 500 });
  }
}
