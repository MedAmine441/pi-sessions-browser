import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let sessionDir: string;
const originalSessionDir = process.env.PI_SESSION_DIR;

beforeEach(async () => {
  sessionDir = await fs.mkdtemp(join(tmpdir(), "pi-routes-"));
  process.env.PI_SESSION_DIR = sessionDir;
  vi.resetModules();
});

afterEach(async () => {
  await fs.rm(sessionDir, { recursive: true, force: true });
  if (originalSessionDir === undefined) delete process.env.PI_SESSION_DIR;
  else process.env.PI_SESSION_DIR = originalSessionDir;
});

const post = (url: string, body: string) =>
  new Request(url, { method: "POST", body });

describe("API route error paths", () => {
  it("answers malformed JSON bodies with an error, not a crash", async () => {
    const { POST } = await import("./chat/route");
    const res = await POST(post("http://127.0.0.1/api/chat", "not-json"));
    expect(res.status).toBeGreaterThanOrEqual(400);
    const data = await res.json();
    expect(typeof data.error).toBe("string");
  });

  it("400s on missing parameters", async () => {
    const { POST: edit } = await import("./message/edit/route");
    const editRes = await edit(
      post("http://127.0.0.1/api/message/edit", JSON.stringify({})),
    );
    expect(editRes.status).toBe(400);

    const { POST: rename } = await import("./session/rename/route");
    const renameRes = await rename(
      post("http://127.0.0.1/api/session/rename", JSON.stringify({ file: "" })),
    );
    expect(renameRes.status).toBe(400);

    const { GET: stream } = await import("./stream/route");
    const streamRes = await stream(new Request("http://127.0.0.1/api/stream"));
    expect(streamRes.status).toBe(400);

    const { DELETE: del } = await import("./sessions/route");
    const deleteRes = await del(
      new Request("http://127.0.0.1/api/sessions", { method: "DELETE" }),
    );
    expect(deleteRes.status).toBe(400);
  });

  it("refuses files outside the session directory", async () => {
    const { POST } = await import("./sessions/discard/route");
    const res = await POST(
      post(
        "http://127.0.0.1/api/sessions/discard",
        JSON.stringify({ file: "/etc/passwd" }),
      ),
    );
    expect(res.status).toBeGreaterThanOrEqual(400);
    const data = await res.json();
    expect(data.error).toContain("outside Pi's session directory");
  });
});
