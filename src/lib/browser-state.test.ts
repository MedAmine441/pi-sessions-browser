import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let agentDir: string;
let state: typeof import("./browser-state");
const originalAgentDir = process.env.PI_AGENT_DIR;

beforeEach(async () => {
  agentDir = await fs.mkdtemp(join(tmpdir(), "pi-browser-state-"));
  process.env.PI_AGENT_DIR = agentDir;
  vi.resetModules();
  state = await import("./browser-state");
});

afterEach(async () => {
  await fs.rm(agentDir, { recursive: true, force: true });
  if (originalAgentDir === undefined) delete process.env.PI_AGENT_DIR;
  else process.env.PI_AGENT_DIR = originalAgentDir;
});

describe("browser sidecar state", () => {
  it("pins and unpins sessions, dropping entries whose files are gone", async () => {
    const alive = join(agentDir, "alive.jsonl");
    const doomed = join(agentDir, "doomed.jsonl");
    await fs.writeFile(alive, "");
    await fs.writeFile(doomed, "");

    await state.setPinned(alive, true);
    await state.setPinned(doomed, true);
    expect((await state.getPinned()).sort()).toEqual([alive, doomed].sort());

    // A deleted session silently leaves the pin list on the next write.
    await fs.rm(doomed);
    await state.setPinned(alive, true);
    expect(await state.getPinned()).toEqual([alive]);

    await state.setPinned(alive, false);
    expect(await state.getPinned()).toEqual([]);
  });

  it("preserves unknown keys in the sidecar file", async () => {
    const file = join(agentDir, "s.jsonl");
    await fs.writeFile(file, "");
    await fs.writeFile(
      join(agentDir, "browser-state.json"),
      JSON.stringify({ someFutureKey: 42, pinned: [] }),
    );
    vi.resetModules();
    state = await import("./browser-state");

    await state.setPinned(file, true);
    const raw = JSON.parse(
      await fs.readFile(join(agentDir, "browser-state.json"), "utf8"),
    );
    expect(raw).toMatchObject({ someFutureKey: 42, pinned: [file] });
  });
});
