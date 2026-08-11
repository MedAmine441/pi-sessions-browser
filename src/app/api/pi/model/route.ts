import { NextResponse } from "next/server";
import { messageOf } from "@/lib/utils";
import { setDefaultModel } from "@/lib/pi-config";
import {
  appendModelChange,
  appendThinkingLevelChange,
  safeSessionPath,
} from "@/lib/pi-sessions";

/**
 * scope "default": the model new sessions start on (settings.json).
 * scope "session": appends a model_change entry to one session file — pi's
 * native mechanism, picked up by the next `pi --session … -p` run.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { scope, provider, modelId, thinkingLevel, file } = body ?? {};
    if (typeof provider !== "string" || typeof modelId !== "string") {
      return NextResponse.json(
        { error: "provider and modelId are required" },
        { status: 400 },
      );
    }

    if (scope === "session") {
      const safePath = await safeSessionPath(typeof file === "string" ? file : null);
      await appendModelChange(safePath, provider, modelId);
      if (typeof thinkingLevel === "string" && thinkingLevel)
        await appendThinkingLevelChange(safePath, thinkingLevel);
      return NextResponse.json({ success: true });
    }
    if (scope === "default") {
      await setDefaultModel(
        provider,
        modelId,
        typeof thinkingLevel === "string" && thinkingLevel ? thinkingLevel : undefined,
      );
      return NextResponse.json({ success: true });
    }
    return NextResponse.json(
      { error: "scope must be \"default\" or \"session\"" },
      { status: 400 },
    );
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: messageOf(error) }, { status: 400 });
  }
}
