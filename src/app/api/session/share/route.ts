import { tmpdir } from "node:os";
import { join } from "node:path";
import { promises as fs } from "node:fs";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { NextResponse } from "next/server";
import { messageOf } from "@/lib/utils";
import { safeSessionPath } from "@/lib/pi-sessions";
import { runPiRpc } from "@/lib/pi-rpc";

/**
 * The /share counterpart, step for step what pi's TUI does: export the
 * session as HTML named session.html, upload it as a secret gist via the gh
 * CLI, and build the viewer link from the gist id.
 */
const shareViewerUrl = (gistId: string) =>
  `${process.env.PI_SHARE_VIEWER_URL || "https://pi.dev/session/"}#${gistId}`;

function createGist(file: string) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn("gh", ["gist", "create", "--public=false", file], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (data) => (stdout += data.toString()));
    child.stderr.on("data", (data) => (stderr += data.toString()));
    child.once("error", (error) =>
      reject(
        (error as NodeJS.ErrnoException).code === "ENOENT"
          ? new Error("Sharing needs the GitHub CLI (gh) installed and logged in.")
          : error,
      ),
    );
    child.once("close", (code) => {
      if (code !== 0)
        return reject(new Error(stderr.trim() || `gh exited with code ${code}`));
      resolve(stdout.trim());
    });
  });
}

export async function POST(request: Request) {
  // The gist file must be named session.html — the viewer looks it up by name.
  const shareDir = join(tmpdir(), `pi-share-${randomUUID().slice(0, 8)}`);
  try {
    const body = await request.json().catch(() => ({}));
    const safePath = await safeSessionPath(
      typeof body?.file === "string" ? body.file : null,
    );

    await fs.mkdir(shareDir, { recursive: true });
    const htmlPath = join(shareDir, "session.html");
    await runPiRpc(safePath, { type: "export_html", outputPath: htmlPath }, 120_000);

    const gistUrl = await createGist(htmlPath);
    const gistId = gistUrl.split("/").pop();
    if (!gistId) throw new Error(`Could not parse the gist id from: ${gistUrl}`);

    return NextResponse.json({
      success: true,
      gistUrl,
      viewerUrl: shareViewerUrl(gistId),
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: messageOf(error) || "Failed to share session" },
      { status: 500 },
    );
  } finally {
    await fs.rm(shareDir, { recursive: true, force: true }).catch(() => {});
  }
}
