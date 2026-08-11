import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import { promises as fs } from "node:fs";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { messageOf } from "@/lib/utils";
import { getConversation, safeSessionPath } from "@/lib/pi-sessions";
import { runPiRpc } from "@/lib/pi-rpc";

/**
 * The /export counterpart: pi renders its own self-contained HTML (via RPC
 * export_html), and the response hands it to the browser as a download.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  let safePath: string;
  try {
    safePath = await safeSessionPath(searchParams.get("file"));
  } catch (error) {
    return NextResponse.json({ error: messageOf(error) }, { status: 400 });
  }

  const outputPath = join(tmpdir(), `pi-export-${randomUUID().slice(0, 8)}.html`);
  try {
    await runPiRpc(safePath, { type: "export_html", outputPath }, 120_000);
    const html = await fs.readFile(outputPath, "utf8");

    const detail = await getConversation(safePath).catch(() => null);
    const stem = (detail?.name || basename(safePath, ".jsonl"))
      .replace(/[^\w.-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80);
    return new NextResponse(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Disposition": `attachment; filename="${stem || "session"}.html"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: messageOf(error) || "Failed to export session" },
      { status: 500 },
    );
  } finally {
    await fs.rm(outputPath, { force: true }).catch(() => {});
  }
}
