import { NextResponse } from "next/server";
import { messageOf } from "@/lib/utils";
import { launchLoginTerminal, loginWithApiKey } from "@/lib/pi-config";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    if (body?.method === "oauth") {
      // Account login is pi's own interactive flow; hand over to a terminal.
      await launchLoginTerminal();
      return NextResponse.json({ launched: true });
    }
    if (body?.method === "api_key") {
      await loginWithApiKey(body.provider, body.apiKey);
      return NextResponse.json({ success: true });
    }
    return NextResponse.json(
      { error: "method must be \"oauth\" or \"api_key\"" },
      { status: 400 },
    );
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: messageOf(error) }, { status: 400 });
  }
}
