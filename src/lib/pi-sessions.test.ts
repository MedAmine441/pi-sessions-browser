import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let sessionDir: string;
let sessions: typeof import("./pi-sessions");
const originalSessionDir = process.env.PI_SESSION_DIR;

async function writeSession(relativePath: string, entries: unknown[]) {
  const file = join(sessionDir, relativePath);
  await fs.mkdir(join(file, ".."), { recursive: true });
  await fs.writeFile(
    file,
    `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`,
  );
  return file;
}

beforeEach(async () => {
  sessionDir = await fs.mkdtemp(join(tmpdir(), "pi-sessions-browser-"));
  process.env.PI_SESSION_DIR = sessionDir;
  vi.resetModules();
  sessions = await import("./pi-sessions");
});

afterEach(async () => {
  await fs.rm(sessionDir, { recursive: true, force: true });
  if (originalSessionDir === undefined) delete process.env.PI_SESSION_DIR;
  else process.env.PI_SESSION_DIR = originalSessionDir;
});

describe("Pi session storage", () => {
  it("lists sessions with metadata and orders them by their latest entry", async () => {
    const older = await writeSession("project/older.jsonl", [
      {
        type: "session",
        id: "older",
        cwd: "/work/older",
        timestamp: "2026-01-01T10:00:00.000Z",
      },
      {
        type: "message",
        timestamp: "2026-01-01T10:01:00.000Z",
        message: { role: "user", content: "First request" },
      },
    ]);
    const newer = await writeSession("project/newer.jsonl", [
      {
        type: "session",
        id: "newer",
        cwd: "/work/newer",
        timestamp: "2026-01-01T11:00:00.000Z",
      },
      { type: "session_info", name: "Named session" },
      {
        type: "message",
        timestamp: "2026-01-01T12:00:00.000Z",
        message: {
          role: "user",
          content: [{ type: "text", text: "A detailed request" }],
        },
      },
    ]);

    const listed = await sessions.listSessions();

    expect(listed).toEqual([
      expect.objectContaining({
        file: newer,
        id: "newer",
        name: "Named session",
        cwd: "/work/newer",
        messageCount: 1,
        preview: "A detailed request",
      }),
      expect.objectContaining({
        file: older,
        id: "older",
        name: null,
        cwd: "/work/older",
        messageCount: 1,
        preview: "First request",
      }),
    ]);
  });

  it("returns displayable conversation entries and ignores hidden custom messages", async () => {
    const file = await writeSession("conversation.jsonl", [
      {
        type: "session",
        id: "conversation",
        cwd: "/work",
        timestamp: "2026-01-01T10:00:00.000Z",
      },
      {
        type: "message",
        id: "user-1",
        timestamp: "2026-01-01T10:01:00.000Z",
        message: {
          role: "user",
          content: [{ type: "text", text: "Hello" }, { type: "image" }],
        },
      },
      {
        type: "message",
        id: "hidden",
        message: { role: "custom", content: "Do not show" },
      },
      {
        type: "compaction",
        id: "compact-1",
        timestamp: "2026-01-01T10:02:00.000Z",
        summary: "Earlier messages were compacted",
      },
      {
        type: "branch_summary",
        id: "branch-1",
        timestamp: "2026-01-01T10:03:00.000Z",
      },
    ]);

    await expect(sessions.getConversation(file)).resolves.toEqual({
      file,
      id: "conversation",
      name: null,
      cwd: "/work",
      createdAt: "2026-01-01T10:00:00.000Z",
      items: [
        {
          id: "user-1",
          timestamp: "2026-01-01T10:01:00.000Z",
          role: "user",
          text: "Hello\n[image]",
          toolName: undefined,
        },
        {
          id: "compact-1",
          timestamp: "2026-01-01T10:02:00.000Z",
          role: "summary",
          text: "Earlier messages were compacted",
        },
        {
          id: "branch-1",
          timestamp: "2026-01-01T10:03:00.000Z",
          role: "summary",
          text: "Branch summary",
        },
      ],
    });
  });

  it("only accepts JSONL files contained in the configured session directory", async () => {
    const file = await writeSession("safe/session.jsonl", []);
    const outside = join(tmpdir(), "outside-session.jsonl");
    await fs.writeFile(outside, "");

    await expect(sessions.safeSessionPath(file)).resolves.toBe(file);
    await expect(sessions.safeSessionPath(outside)).rejects.toThrow(
      "outside Pi's session directory",
    );

    await fs.rm(outside, { force: true });
  });
});
