import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let stubDir: string;
let rpc: typeof import("./pi-rpc");
const originalPiCommand = process.env.PI_COMMAND;

/** A stand-in for `pi --mode rpc`: reads JSONL commands, answers per script. */
async function useStub(body: string) {
  const path = join(stubDir, "stub.js");
  await fs.writeFile(
    path,
    `let buffer = "";
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  const newline = buffer.indexOf("\\n");
  if (newline < 0) return;
  const command = JSON.parse(buffer.slice(0, newline));
  ${body}
});
process.stdin.resume();
`,
  );
  process.env.PI_COMMAND = `node ${path}`;
  vi.resetModules();
  rpc = await import("./pi-rpc");
}

beforeEach(async () => {
  stubDir = await fs.mkdtemp(join(tmpdir(), "pi-rpc-stub-"));
});

afterEach(async () => {
  await fs.rm(stubDir, { recursive: true, force: true });
  if (originalPiCommand === undefined) delete process.env.PI_COMMAND;
  else process.env.PI_COMMAND = originalPiCommand;
});

describe("pi RPC runner", () => {
  it("resolves with the data of the id-matched response, skipping events", async () => {
    await useStub(`
      process.stdout.write(JSON.stringify({ type: "message_start" }) + "\\n");
      process.stdout.write(JSON.stringify({ id: "other", type: "response", command: command.type, success: true, data: { wrong: true } }) + "\\n");
      process.stdout.write(JSON.stringify({ id: command.id, type: "response", command: command.type, success: true, data: { ok: true, file: process.env.PI_FILE } }) + "\\n");
    `);
    const data = await rpc.runPiRpc<{ ok: boolean; file: string }>(
      "/tmp/some session.jsonl",
      { type: "export_html" },
      10_000,
    );
    expect(data.ok).toBe(true);
    expect(data.file).toBe("/tmp/some session.jsonl");
  });

  it("rejects when pi reports a failure", async () => {
    await useStub(`
      process.stdout.write(JSON.stringify({ id: command.id, type: "response", command: command.type, success: false, error: "no model configured" }) + "\\n");
    `);
    await expect(
      rpc.runPiRpc("/tmp/x.jsonl", { type: "compact" }, 10_000),
    ).rejects.toThrow("no model configured");
  });

  it("rejects when pi exits before answering", async () => {
    await useStub(`process.exit(3);`);
    await expect(
      rpc.runPiRpc("/tmp/x.jsonl", { type: "compact" }, 10_000),
    ).rejects.toThrow("exited before answering");
  });
});
