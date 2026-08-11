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
      preview: "Hello [image]",
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

  it("parses the UTC timestamp out of session filenames", () => {
    expect(
      sessions
        .timestampFromFilename("/x/2026-08-09T19-28-48-916Z_uuid.jsonl")
        ?.toISOString(),
    ).toBe("2026-08-09T19:28:48.916Z");
    expect(sessions.timestampFromFilename("/x/older.jsonl")).toBeNull();
  });

  it("groups and filters sessions by a canonical YYYY-MM-DD key", async () => {
    const entries = [
      {
        type: "session",
        id: "dated",
        cwd: "/work",
        timestamp: "2026-03-05T12:00:00.000Z",
      },
      {
        type: "message",
        id: "msg-1",
        timestamp: "2026-03-05T12:01:00.000Z",
        message: { role: "user", content: "Hi" },
      },
    ];
    await writeSession("project/2026-03-05T12-00-00-000Z_abc.jsonl", entries);
    await writeSession("project/2026-03-06T12-00-00-000Z_def.jsonl", entries);

    // The two stamps are a day apart, so they land on distinct local days in
    // every timezone even though the exact key depends on the zone.
    const dates = await sessions.listDates();
    expect(dates.every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d.date))).toBe(true);
    expect(dates.map((d) => d.count)).toEqual([1, 1]);
    expect(dates[0].date > dates[1].date).toBe(true);

    const listed = await sessions.listSessions(dates[1].date);
    expect(listed).toHaveLength(1);
    expect(listed[0].file).toContain("2026-03-05T12-00-00-000Z_abc.jsonl");
  });

  it("renames sessions in Pi's own session_info format", async () => {
    const file = await writeSession("project/renamed.jsonl", [
      {
        type: "session",
        id: "renamed",
        cwd: "/work",
        timestamp: "2026-01-01T10:00:00.000Z",
      },
      {
        type: "message",
        id: "msg-1",
        parentId: null,
        timestamp: "2026-01-01T10:01:00.000Z",
        message: { role: "user", content: "Hello" },
      },
    ]);

    await sessions.renameSession(file, "  A new\nname  ");

    const raw = await fs.readFile(file, "utf8");
    const appended = JSON.parse(raw.trim().split("\n").at(-1)!);
    expect(appended).toMatchObject({
      type: "session_info",
      parentId: "msg-1",
      name: "A new name",
    });
    expect(appended.id).toMatch(/^[0-9a-f-]{8}$/);

    const [listed] = await sessions.listSessions();
    expect(listed.name).toBe("A new name");
  });

  it("edits messages with string and array content, and reports misses", async () => {
    const file = await writeSession("project/edit.jsonl", [
      {
        type: "session",
        id: "edit",
        cwd: "/work",
        timestamp: "2026-01-01T10:00:00.000Z",
      },
      {
        type: "message",
        id: "plain",
        timestamp: "2026-01-01T10:01:00.000Z",
        message: { role: "user", content: "Original string" },
      },
      {
        type: "message",
        id: "rich",
        timestamp: "2026-01-01T10:02:00.000Z",
        message: {
          role: "user",
          content: [{ type: "text", text: "Original text" }],
        },
      },
      {
        type: "message",
        id: "textless",
        timestamp: "2026-01-01T10:03:00.000Z",
        message: { role: "user", content: [{ type: "image" }] },
      },
    ]);

    await sessions.editMessage(file, "plain", "Edited string");
    await sessions.editMessage(file, "rich", "Edited text");

    const conversation = await sessions.getConversation(file);
    expect(conversation.items.map((item) => item.text)).toEqual([
      "Edited string",
      "Edited text",
      "[image]",
    ]);

    await expect(
      sessions.editMessage(file, "missing", "x"),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      sessions.editMessage(file, "textless", "x"),
    ).rejects.toMatchObject({ status: 422 });
  });

  it("discards a session only while it holds no messages", async () => {
    const empty = await writeSession("project/empty.jsonl", [
      {
        type: "session",
        id: "empty",
        cwd: "/work",
        timestamp: "2026-01-01T10:00:00.000Z",
      },
    ]);
    const used = await writeSession("project/used.jsonl", [
      {
        type: "session",
        id: "used",
        cwd: "/work",
        timestamp: "2026-01-01T10:00:00.000Z",
      },
      {
        type: "message",
        id: "msg-1",
        timestamp: "2026-01-01T10:01:00.000Z",
        message: { role: "user", content: "Keep me" },
      },
    ]);

    await expect(sessions.discardIfEmpty(used)).resolves.toBe(false);
    await expect(sessions.discardIfEmpty(empty)).resolves.toBe(true);
    await expect(fs.stat(empty)).rejects.toThrow();
    await expect(fs.stat(used)).resolves.toBeTruthy();
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

  it("rejects a symlink inside the session dir that points outside it", async () => {
    const outside = join(tmpdir(), "pi-sessions-symlink-target.jsonl");
    await fs.writeFile(outside, "");
    const link = join(sessionDir, "sneaky.jsonl");
    await fs.symlink(outside, link);

    await expect(sessions.safeSessionPath(link)).rejects.toThrow(
      "outside Pi's session directory",
    );

    await fs.rm(outside, { force: true });
  });
});
