import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";

/**
 * The browser's own sidecar state — the one thing this app persists that pi
 * does not. Lives beside pi's config (PI_AGENT_DIR-aware) so it travels with
 * the rest of the agent's files. Currently: pinned session paths.
 */
const agentDir = resolve(process.env.PI_AGENT_DIR || `${homedir()}/.pi/agent`);
const statePath = resolve(agentDir, "browser-state.json");

type BrowserState = Record<string, unknown>;

function pinnedFrom(state: BrowserState): string[] {
  return Array.isArray(state.pinned)
    ? state.pinned.filter((entry): entry is string => typeof entry === "string")
    : [];
}

async function readState(): Promise<BrowserState> {
  try {
    return JSON.parse(await fs.readFile(statePath, "utf8")) as BrowserState;
  } catch {
    return {};
  }
}

async function writeState(state: BrowserState) {
  await fs.mkdir(dirname(statePath), { recursive: true });
  const temp = `${statePath}.${randomUUID().slice(0, 8)}.tmp`;
  await fs.writeFile(temp, JSON.stringify(state, null, 1) + "\n", "utf-8");
  await fs.rename(temp, statePath);
}

export async function getPinned(): Promise<string[]> {
  return pinnedFrom(await readState());
}

/** Pins or unpins one session, dropping entries whose files are gone. */
export async function setPinned(file: string, pinned: boolean) {
  const state = await readState();
  const current = new Set(pinnedFrom(state));
  if (pinned) current.add(file);
  else current.delete(file);

  const kept: string[] = [];
  for (const path of current) {
    const exists = await fs
      .stat(path)
      .then((s) => s.isFile())
      .catch(() => false);
    if (exists) kept.push(path);
  }
  await writeState({ ...state, pinned: kept });
  return kept;
}
