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
      model: null,
      items: [
        {
          id: "user-1",
          timestamp: "2026-01-01T10:01:00.000Z",
          role: "user",
          text: "Hello\n[image]",
          // The dataless image part is dropped; only renderable parts ride.
          parts: [{ type: "text", text: "Hello" }],
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

  it("surfaces structured parts, usage, errors, and bash runs on conversation items", async () => {
    const usage = {
      input: 2100,
      output: 520,
      cacheRead: 1800,
      cacheWrite: 0,
      totalTokens: 4420,
      cost: { input: 0.0042, output: 0.0052, cacheRead: 0.00036, cacheWrite: 0, total: 0.00976 },
    };
    const file = await writeSession("project/rich.jsonl", [
      {
        type: "session",
        id: "rich",
        cwd: "/work",
        timestamp: "2026-01-01T10:00:00.000Z",
      },
      {
        type: "message",
        id: "ask",
        timestamp: "2026-01-01T10:01:00.000Z",
        message: { role: "user", content: "Run it" },
      },
      {
        type: "message",
        id: "reply",
        timestamp: "2026-01-01T10:02:00.000Z",
        message: {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "Look before running.", thinkingSignature: "sig" },
            { type: "text", text: "Running now." },
            { type: "toolCall", id: "call_1", name: "bash", arguments: { command: "ls" } },
          ],
          provider: "anthropic",
          model: "claude-opus-4-6",
          usage,
          stopReason: "error",
          errorMessage: "overloaded",
        },
      },
      {
        type: "message",
        id: "result",
        timestamp: "2026-01-01T10:03:00.000Z",
        message: {
          role: "toolResult",
          toolCallId: "call_1",
          toolName: "bash",
          content: [{ type: "text", text: "ls: boom" }],
          isError: true,
        },
      },
      {
        type: "message",
        id: "bash",
        timestamp: "2026-01-01T10:04:00.000Z",
        message: {
          role: "bashExecution",
          command: "echo hi",
          output: "hi",
          exitCode: 0,
          cancelled: false,
          truncated: false,
        },
      },
      {
        type: "compaction",
        id: "squeeze",
        timestamp: "2026-01-01T10:05:00.000Z",
        summary: "Older context squeezed",
        tokensBefore: 50000,
        usage: { cost: { total: 0.001 } },
      },
    ]);

    const conversation = await sessions.getConversation(file);
    const byId = Object.fromEntries(conversation.items.map((i) => [i.id, i]));

    expect(byId.reply).toMatchObject({
      role: "assistant",
      parts: [
        { type: "thinking", thinking: "Look before running." },
        { type: "text", text: "Running now." },
        { type: "toolCall", id: "call_1", name: "bash", arguments: { command: "ls" } },
      ],
      usage: { input: 2100, output: 520, totalTokens: 4420, cost: { total: 0.00976 } },
      model: "claude-opus-4-6",
      stopReason: "error",
      errorMessage: "overloaded",
    });
    expect(byId.result).toMatchObject({
      role: "toolResult",
      toolCallId: "call_1",
      isError: true,
      text: "ls: boom",
    });
    expect(byId.bash).toMatchObject({
      role: "bashExecution",
      text: "$ echo hi",
      command: "echo hi",
      output: "hi",
      exitCode: 0,
    });
    expect(byId.squeeze).toMatchObject({
      role: "summary",
      tokensBefore: 50000,
      usage: { cost: { total: 0.001 } },
    });

    // The summary rolls cost up from every usage-bearing entry and flags the
    // assistant error for the session card.
    const [listed] = await sessions.listSessions();
    expect(listed.cost).toBeCloseTo(0.01076, 10);
    expect(listed.hasError).toBe(true);
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

  it("tracks and switches the session's model the way pi does", async () => {
    const file = await writeSession("project/model.jsonl", [
      {
        type: "session",
        id: "model",
        cwd: "/work",
        timestamp: "2026-01-01T10:00:00.000Z",
      },
      {
        type: "message",
        id: "msg-1",
        parentId: null,
        timestamp: "2026-01-01T10:01:00.000Z",
        message: { role: "user", content: "Hi" },
      },
      {
        type: "message",
        id: "msg-2",
        parentId: "msg-1",
        timestamp: "2026-01-01T10:02:00.000Z",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Hello" }],
          provider: "anthropic",
          model: "claude-opus-4-6",
        },
      },
    ]);

    // The latest assistant message carries the current model…
    await expect(sessions.getConversation(file)).resolves.toMatchObject({
      model: { provider: "anthropic", modelId: "claude-opus-4-6" },
    });

    // …and an appended model_change (pi's own mechanism) overrides it.
    await sessions.appendModelChange(file, "moonshotai", "kimi-k2-thinking");
    const raw = await fs.readFile(file, "utf8");
    const appended = JSON.parse(raw.trim().split("\n").at(-1)!);
    expect(appended).toMatchObject({
      type: "model_change",
      provider: "moonshotai",
      modelId: "kimi-k2-thinking",
      parentId: "msg-2",
    });
    await expect(sessions.getConversation(file)).resolves.toMatchObject({
      model: { provider: "moonshotai", modelId: "kimi-k2-thinking" },
    });
  });

  it("forks a session the way pi's forkFrom does", async () => {
    const source = await writeSession("project/source.jsonl", [
      {
        type: "session",
        version: 3,
        id: "source",
        cwd: "/work",
        timestamp: "2026-01-01T10:00:00.000Z",
      },
      {
        type: "message",
        id: "msg-1",
        parentId: null,
        timestamp: "2026-01-01T10:01:00.000Z",
        message: { role: "user", content: "Original" },
      },
    ]);

    const forked = await sessions.forkSession(source);

    expect(forked).not.toBe(source);
    expect(forked.startsWith(join(sessionDir, "project"))).toBe(true);
    const lines = (await fs.readFile(forked, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(lines[0]).toMatchObject({
      type: "session",
      version: 3,
      cwd: "/work",
      parentSession: source,
    });
    expect(lines[0].id).not.toBe("source");
    // Every non-header entry rides along, ids intact.
    expect(lines.slice(1)).toEqual([
      expect.objectContaining({ type: "message", id: "msg-1" }),
    ]);
    // The original is untouched.
    const original = await fs.readFile(source, "utf8");
    expect(original).toContain('"id":"source"');
    expect(original).not.toContain("parentSession");
  });

  it("clones the active branch and forks from an entry like pi's createBranchedSession", async () => {
    // root ─ answer ─ branchA (abandoned) … branchB (active, file's last entry)
    const file = await writeSession("project/branched.jsonl", [
      {
        type: "session",
        version: 3,
        id: "branched",
        cwd: "/work",
        timestamp: "2026-01-01T10:00:00.000Z",
      },
      {
        type: "message",
        id: "root",
        parentId: null,
        timestamp: "2026-01-01T10:01:00.000Z",
        message: { role: "user", content: "Start" },
      },
      {
        type: "model_change",
        id: "change",
        parentId: "root",
        timestamp: "2026-01-01T10:01:30.000Z",
        provider: "anthropic",
        modelId: "claude-opus-4-6",
      },
      {
        type: "message",
        id: "answer",
        parentId: "change",
        timestamp: "2026-01-01T10:02:00.000Z",
        message: { role: "assistant", content: [{ type: "text", text: "Reply" }] },
      },
      {
        type: "message",
        id: "branchA",
        parentId: "answer",
        timestamp: "2026-01-01T10:03:00.000Z",
        message: { role: "user", content: "Try approach A" },
      },
      {
        type: "message",
        id: "branchB",
        parentId: "answer",
        timestamp: "2026-01-01T10:04:00.000Z",
        message: { role: "user", content: "Actually, approach B" },
      },
    ]);

    // Clone: the active branch is the ancestry of the file's LAST entry, so
    // branchA must not survive, and parentIds re-chain linearly.
    const clone = await sessions.branchSessionAt(file);
    const cloned = (await fs.readFile(clone, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(cloned[0]).toMatchObject({ type: "session", parentSession: file });
    expect(cloned.slice(1).map((e: { id: string }) => e.id)).toEqual([
      "root",
      "change",
      "answer",
      "branchB",
    ]);
    expect(cloned.slice(1).map((e: { parentId: string | null }) => e.parentId)).toEqual([
      null,
      "root",
      "change",
      "answer",
    ]);

    // Fork from an entry (position "at"): the entry's own branch, inclusive.
    const forked = await sessions.branchSessionAt(file, "branchA");
    const forkedIds = (await fs.readFile(forked, "utf8"))
      .trim()
      .split("\n")
      .slice(1)
      .map((line) => JSON.parse(line).id);
    expect(forkedIds).toEqual(["root", "change", "answer", "branchA"]);

    // The tree view parents items to their nearest displayable ancestor
    // (skipping the model_change) and marks the active path.
    const tree = await sessions.getSessionTree(file);
    const byId = Object.fromEntries(tree.nodes.map((n) => [n.id, n]));
    expect(byId.answer.parentId).toBe("root");
    expect(byId.branchA.parentId).toBe("answer");
    expect(byId.branchB.parentId).toBe("answer");
    expect(tree.leafId).toBe("branchB");
    expect(tree.nodes.filter((n) => n.active).map((n) => n.id)).toEqual([
      "root",
      "answer",
      "branchB",
    ]);
  });

  it("groups sessions by their header cwd, not the lossy directory name", async () => {
    // /work/cosmic-text and /work/cosmic/text encode to the same directory
    // name, so they can end up sharing one folder on disk.
    const shared = "--work-cosmic-text--";
    await writeSession(`${shared}/a.jsonl`, [
      {
        type: "session",
        id: "dashed",
        cwd: "/work/cosmic-text",
        timestamp: "2026-03-05T12:00:00.000Z",
      },
      {
        type: "message",
        id: "m1",
        timestamp: "2026-03-05T12:01:00.000Z",
        message: { role: "user", content: "in the dashed folder" },
      },
    ]);
    await writeSession(`${shared}/b.jsonl`, [
      {
        type: "session",
        id: "nested",
        cwd: "/work/cosmic/text",
        timestamp: "2026-03-05T13:00:00.000Z",
      },
      {
        type: "message",
        id: "m2",
        timestamp: "2026-03-05T13:01:00.000Z",
        message: { role: "user", content: "in the nested folder" },
      },
    ]);
    // A legacy directory-name variant of the same cwd merges into it.
    await writeSession("--work-cosmic-text/c.jsonl", [
      {
        type: "session",
        id: "variant",
        cwd: "/work/cosmic-text",
        timestamp: "2026-03-05T14:00:00.000Z",
      },
      {
        type: "message",
        id: "m3",
        timestamp: "2026-03-05T14:01:00.000Z",
        message: { role: "user", content: "legacy dir name" },
      },
    ]);

    await expect(sessions.getLocations()).resolves.toEqual([
      "/work/cosmic-text",
      "/work/cosmic/text",
    ]);
    const dashed = await sessions.listSessions(undefined, "/work/cosmic-text");
    expect(dashed.map((s) => s.id).sort()).toEqual(["dashed", "variant"]);
    const nested = await sessions.listSessions(undefined, "/work/cosmic/text");
    expect(nested.map((s) => s.id)).toEqual(["nested"]);
  });

  it("decodes headerless directory names against the real filesystem, dashes intact", async () => {
    const base = await fs.mkdtemp(join(tmpdir(), "pi-decode-"));
    try {
      await fs.mkdir(join(base, "cosmic-text"));
      await fs.mkdir(join(base, "--"));
      const encode = (p: string) => `--${p.slice(1).replace(/\//g, "-")}--`;
      const message = {
        type: "message",
        id: "m1",
        timestamp: "2026-03-05T12:00:00.000Z",
        message: { role: "user", content: "hi" },
      };

      // No cwd in any header: the directory name is all there is to go on.
      await writeSession(`${encode(join(base, "cosmic-text"))}/a.jsonl`, [message]);
      await writeSession(`${encode(join(base, "--"))}/b.jsonl`, [message]);
      // A path that no longer exists keeps its tail as one dashed segment.
      await writeSession(`${encode(join(base, "deleted-project"))}/c.jsonl`, [message]);

      const locations = await sessions.getLocations();
      expect(locations).toContain(join(base, "cosmic-text"));
      expect(locations).toContain(join(base, "--"));
      expect(locations).toContain(join(base, "deleted-project"));
    } finally {
      await fs.rm(base, { recursive: true, force: true });
    }
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
