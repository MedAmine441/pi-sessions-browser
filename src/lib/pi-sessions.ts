import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, extname, resolve, sep } from "node:path";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

const sessionRoot = resolve(
  process.env.PI_SESSION_DIR || `${homedir()}/.pi/agent/sessions`,
);
const terminal = process.env.PI_TERMINAL || "x-terminal-emulator";
const piCommand = process.env.PI_COMMAND || "pi";
const maxSessionBytes = Number(
  process.env.PI_SESSION_BROWSER_MAX_BYTES || 100 * 1024 * 1024,
);
let canonicalRoot: string;

function textFrom(content: any): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (part?.type === "text") return part.text || "";
      if (part?.type === "thinking") return "[thinking]";
      if (part?.type === "toolCall") return `[tool: ${part.name}]`;
      if (part?.type === "image") return "[image]";
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function short(value: string, limit = 220) {
  const normalized = String(value || "")
    .replace(/\s+/g, " ")
    .trim();
  return normalized.length > limit
    ? `${normalized.slice(0, limit - 1)}…`
    : normalized;
}

async function walk(directory: string): Promise<string[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const results = [];
  for (const entry of entries) {
    const file = resolve(directory, entry.name);
    if (entry.isDirectory()) results.push(...(await walk(file)));
    else if (entry.isFile() && extname(entry.name) === ".jsonl")
      results.push(file);
  }
  return results;
}

async function initCanonicalRoot() {
  if (canonicalRoot) return;
  await fs.mkdir(sessionRoot, { recursive: true });
  canonicalRoot = await fs.realpath(sessionRoot);
}

export async function safeSessionPath(candidate: string | null) {
  await initCanonicalRoot();
  if (typeof candidate !== "string" || !candidate)
    throw new Error("A session path is required.");
  const real = await fs.realpath(resolve(candidate));
  if (
    !(real === canonicalRoot || real.startsWith(`${canonicalRoot}${sep}`)) ||
    extname(real) !== ".jsonl"
  ) {
    throw new Error("That file is outside Pi's session directory.");
  }
  return real;
}

async function load(file: string) {
  const stat = await fs.stat(file);
  if (stat.size > maxSessionBytes)
    throw new Error(
      `Session is larger than the ${Math.round(maxSessionBytes / 1024 / 1024)} MB safety limit.`,
    );
  const raw = await fs.readFile(file, "utf8");
  const entries = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line));
    } catch {
      /* A partially-written final JSONL line is safe to ignore. */
    }
  }
  return { stat, entries };
}

function summarize(file: string, stat: any, entries: any[]) {
  const header = entries.find((entry) => entry.type === "session") || {};
  const name = entries.findLast((entry) => entry.type === "name")?.name;
  const messages = entries.filter((entry) => entry.type === "message");
  const firstUser = messages.find((entry) => entry.message?.role === "user");
  const last = entries.at(-1);
  return {
    file,
    id: header.id || basename(file).replace(/\.jsonl$/, ""),
    name: name || null,
    cwd: header.cwd || dirname(file),
    createdAt: header.timestamp || stat.birthtime.toISOString(),
    updatedAt: last?.timestamp || stat.mtime.toISOString(),
    messageCount: messages.length,
    preview: short(textFrom(firstUser?.message?.content) || "No user message"),
    size: stat.size,
  };
}

/** Pi encodes a session's cwd as its directory name: /home/pc -> --home-pc-- */
function encodeCwd(cwd: string) {
  return `--${cwd.replace(/^\/+/, "").replace(/\/+$/, "").replace(/\//g, "-")}--`;
}

/**
 * The encoding is lossy — a "-" in a folder name is indistinguishable from a
 * separator — so this walks the real filesystem, taking the longest segment
 * that exists at each step. Only used for directories with no session to read
 * the cwd from; a path that no longer exists degrades to the naive split.
 */
async function decodeDirName(name: string) {
  const parts = name.replace(/^-+/, "").replace(/-+$/, "").split("-");
  let path = "";
  for (let i = 0; i < parts.length; ) {
    let matched = 0;
    for (let end = parts.length; end > i; end--) {
      const candidate = `${path}/${parts.slice(i, end).join("-")}`;
      const isDir = await fs
        .stat(candidate)
        .then((s) => s.isDirectory())
        .catch(() => false);
      if (isDir) {
        path = candidate;
        matched = end;
        break;
      }
    }
    if (!matched) return `${path}/${parts.slice(i).join("/")}`;
    i = matched;
  }
  return path;
}

/** Reads the cwd out of a session's header line without loading the whole file. */
async function readSessionCwd(file: string) {
  let handle;
  try {
    handle = await fs.open(file, "r");
    const { buffer, bytesRead } = await handle.read({
      buffer: Buffer.alloc(8192),
      position: 0,
    });
    const header = buffer.subarray(0, bytesRead).toString("utf8").split("\n")[0];
    const cwd = JSON.parse(header)?.cwd;
    return typeof cwd === "string" && cwd ? cwd : null;
  } catch {
    return null;
  } finally {
    await handle?.close();
  }
}

/**
 * A session Pi has never written a message to holds nothing worth browsing, so
 * it is left out of the listings entirely.
 */
async function hasMessages(file: string) {
  try {
    const { size } = await fs.stat(file);
    // Nothing that large can be an untouched session, and reading it would hurt.
    if (size > maxSessionBytes) return true;
    const raw = await fs.readFile(file, "utf8");
    return raw.includes('"type":"message"');
  } catch {
    return false;
  }
}

async function inspectDir(name: string) {
  const dir = resolve(canonicalRoot, name);
  let sessions: string[] = [];
  try {
    sessions = (await fs.readdir(dir)).filter((f) => f.endsWith(".jsonl")).sort();
  } catch {
    /* Unreadable directories fall back to the decoded name. */
  }

  let cwd: string | null = null;
  let used = false;
  for (const session of sessions) {
    const file = resolve(dir, session);
    if (!cwd) cwd = await readSessionCwd(file);
    if (!used) used = await hasMessages(file);
    if (cwd && used) break;
  }
  return { cwd: cwd || (await decodeDirName(name)), used };
}

/**
 * Directories are grouped by the real cwd they hold sessions for, so variants
 * of the same path (--home-pc and --home-pc--) show up as a single location.
 */
async function locationIndex() {
  await initCanonicalRoot();
  let entries;
  try {
    entries = await fs.readdir(canonicalRoot, { withFileTypes: true });
  } catch (error: any) {
    if (error?.code === "ENOENT") return new Map<string, { dirs: string[]; used: boolean }>();
    throw error;
  }

  const names = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  const inspected = await Promise.all(names.map(inspectDir));
  const index = new Map<string, { dirs: string[]; used: boolean }>();
  names.forEach((name, i) => {
    const { cwd, used } = inspected[i];
    const entry = index.get(cwd) || { dirs: [], used: false };
    index.set(cwd, { dirs: [...entry.dirs, name], used: entry.used || used });
  });
  return index;
}

/** Only folders that still hold a session worth opening. */
export async function getLocations() {
  const index = await locationIndex();
  return [...index]
    .filter(([, entry]) => entry.used)
    .map(([path]) => path)
    .sort((a, b) => a.localeCompare(b));
}

export function getDefaultLocation() {
  return homedir();
}

/** Backs the folder picker: sub-directories of `target`, defaulting to home. */
export async function listDirectories(target?: string) {
  const path = resolve(target || homedir());
  const entries = await fs.readdir(path, { withFileTypes: true });
  const named = await Promise.all(
    entries.map(async (entry) => {
      if (entry.isDirectory()) return entry.name;
      if (!entry.isSymbolicLink()) return null;
      const linked = await fs.stat(resolve(path, entry.name)).catch(() => null);
      return linked?.isDirectory() ? entry.name : null;
    }),
  );
  const parent = dirname(path);
  return {
    path,
    parent: parent === path ? null : parent,
    directories: named
      .filter((name): name is string => Boolean(name))
      .sort((a, b) => a.localeCompare(b)),
  };
}

async function collectFiles(location?: string) {
  await initCanonicalRoot();
  let targets = [canonicalRoot];
  if (location) {
    const index = await locationIndex();
    // Older links carried the raw directory name rather than the cwd.
    const dirs =
      index.get(location)?.dirs ||
      ([...index.values()].flatMap((entry) => entry.dirs).includes(location)
        ? [location]
        : []);
    targets = dirs.map((dir) => resolve(canonicalRoot, dir));
  }

  const files: string[] = [];
  for (const target of targets) {
    const safeTarget = await fs.realpath(target).catch(() => null);
    if (
      !safeTarget ||
      !(safeTarget === canonicalRoot || safeTarget.startsWith(`${canonicalRoot}${sep}`))
    ) {
      continue;
    }
    try {
      files.push(...(await walk(safeTarget)));
    } catch (error: any) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  return files;
}

export async function listDates(location?: string) {
  const all = await collectFiles(location);
  const used = await Promise.all(all.map(hasMessages));
  const files = all.filter((_, i) => used[i]);

  const dates: Record<string, number> = {};
  for (const file of files) {
    const filename = basename(file);
    const match = filename.match(
      /^(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)/,
    );
    if (match) {
      try {
        const datePart = match[1].substring(0, 10);
        const timePart = match[1]
          .substring(10)
          .replace(/-/g, ":")
          .replace(/:(\d{3}Z)$/, ".$1");
        const iso = datePart + timePart;
        const dateStr = new Date(iso).toLocaleDateString();
        dates[dateStr] = (dates[dateStr] || 0) + 1;
      } catch (e) {}
    }
  }

  return Object.entries(dates)
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

export async function listSessions(targetDate?: string, location?: string) {
  let files = await collectFiles(location);

  if (targetDate) {
    files = files.filter((file) => {
      const filename = basename(file);
      const match = filename.match(
        /^(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)/,
      );
      if (match) {
        try {
          const datePart = match[1].substring(0, 10);
          const timePart = match[1]
            .substring(10)
            .replace(/-/g, ":")
            .replace(/:(\d{3}Z)$/, ".$1");
          const iso = datePart + timePart;
          return new Date(iso).toLocaleDateString() === targetDate;
        } catch (e) {
          return false;
        }
      }
      return false;
    });
  }

  const loaded = await Promise.all(
    files.map(async (file) => {
      try {
        const { stat, entries } = await load(file);
        return summarize(file, stat, entries);
      } catch (error: any) {
        console.warn(`Skipping ${file}: ${error.message}`);
        return null;
      }
    }),
  );

  return loaded
    .filter((session): session is NonNullable<typeof session> =>
      Boolean(session && session.messageCount > 0),
    )
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

export async function getConversation(file: string) {
  const { entries } = await load(file);
  const header = entries.find((entry) => entry.type === "session") || {};
  const name = entries.findLast((entry) => entry.type === "name")?.name;
  const items = [];
  for (const entry of entries) {
    if (entry.type === "message") {
      const message = entry.message || {};
      if (message.role === "custom" && !message.display) continue;
      items.push({
        id: entry.id,
        timestamp: entry.timestamp || message.timestamp,
        role: message.role || "message",
        text: textFrom(message.content),
        toolName: message.toolName,
      });
    } else if (entry.type === "compaction") {
      items.push({
        id: entry.id,
        timestamp: entry.timestamp,
        role: "summary",
        text: entry.summary || "Conversation compacted",
      });
    } else if (entry.type === "branch_summary") {
      items.push({
        id: entry.id,
        timestamp: entry.timestamp,
        role: "summary",
        text: entry.summary || "Branch summary",
      });
    }
  }
  const firstUserMsg = entries.find(
    (e) => e.type === "message" && e.message?.role === "user",
  )?.message?.content;
  let preview = "";
  if (firstUserMsg) {
    preview = short(textFrom(firstUserMsg) || "");
  }

  return {
    file,
    id: header.id,
    name: name || null,
    cwd: header.cwd,
    createdAt: header.timestamp,
    items,
    preview,
  };
}

export async function launchSession(file: string) {
  const { entries } = await load(file);
  const cwd = entries.find((entry) => entry.type === "session")?.cwd;
  if (!cwd || typeof cwd !== "string")
    throw new Error("The session has no working directory.");

  // Values are passed as positional bash arguments, never interpolated into shell code.
  const script = 'cd -- "$1" || exit; exec "$2" --session "$3"';
  const child = spawn(
    terminal,
    ["-e", "bash", "-lc", script, "pi-sessions-browser", cwd, piCommand, file],
    {
      detached: true,
      stdio: "ignore",
      env: process.env,
    },
  );
  child.once("error", (error) =>
    console.error(`Could not launch ${terminal}: ${error.message}`),
  );
  child.unref();
}

export async function deleteSession(file: string) {
  await fs.unlink(file);
  await pruneEmptyDir(file);
}

/**
 * A session that was opened and closed without ever being written to is not
 * worth keeping, so closing it throws it away rather than leaving an empty
 * card behind.
 */
export async function discardIfEmpty(file: string) {
  if (await hasMessages(file)) return false;
  await deleteSession(file);
  return true;
}

/** Drops a location's folder once its last session is gone. */
async function pruneEmptyDir(file: string) {
  await initCanonicalRoot();
  const dir = dirname(file);
  if (dir === canonicalRoot || !dir.startsWith(`${canonicalRoot}${sep}`)) return;
  const remaining = await fs.readdir(dir).catch(() => null);
  if (remaining?.length === 0) await fs.rmdir(dir).catch(() => {});
}

export async function launchNewSession(targetCwd?: string) {
  const workingDir = targetCwd || homedir();
  const script = 'cd -- "$1" || exit; exec "$2"';
  const child = spawn(
    terminal,
    ["-e", "bash", "-lc", script, "pi-sessions-browser", workingDir, piCommand],
    {
      detached: true,
      stdio: "ignore",
      env: process.env,
    },
  );
  child.once("error", (error) =>
    console.error(`Could not launch ${terminal}: ${error.message}`),
  );
  child.unref();
}

export async function sendChatMessage(file: string, message: string) {
  // Pi has to run in the session's own folder, not wherever the app was started.
  const recorded = await readSessionCwd(file);
  const cwd =
    recorded &&
    (await fs
      .stat(recorded)
      .then((s) => s.isDirectory())
      .catch(() => false))
      ? recorded
      : homedir();

  return new Promise<void>((done, reject) => {
    const isWin = process.platform === "win32";
    if (isWin) {
      const child = spawn(piCommand, ["--session", file, "-p", message], {
        stdio: "ignore",
        cwd,
        env: process.env,
        shell: true,
      });
      child.once("error", (error) => reject(error));
      child.once("close", (code) => {
        if (code !== 0 && code !== null)
          reject(new Error(`Process exited with code ${code}`));
        else done();
      });
    } else {
      // Use an interactive shell (-ic) to ensure aliases (like 'pi') are expanded.
      // Pass file and message as environment variables to prevent shell injection.
      const child = spawn(
        "bash",
        ["-ic", `${piCommand} --session "$PI_FILE" -p "$PI_MESSAGE"`],
        {
          stdio: ["ignore", "ignore", "pipe"],
          cwd,
          env: {
            ...process.env,
            PI_FILE: file,
            PI_MESSAGE: message,
          },
        },
      );

      let stderr = "";
      if (child.stderr) {
        child.stderr.on("data", (data) => (stderr += data.toString()));
      }

      child.once("error", (error) => reject(error));
      child.once("close", (code) => {
        if (code !== 0 && code !== null) {
          reject(
            new Error(
              `Message failed to send. Code ${code}. Error: ${stderr.trim()}`,
            ),
          );
        } else {
          done();
        }
      });
    }
  });
}

export async function createNewSessionFile(targetCwd?: string) {
  await initCanonicalRoot();
  const cwd = resolve(targetCwd || homedir());
  const stat = await fs.stat(cwd).catch(() => null);
  if (!stat?.isDirectory()) throw new Error(`${cwd} is not a folder.`);
  const id = randomUUID();
  const timestamp = new Date().toISOString();

  // Format matches standard pi session path: ~/.pi/agent/sessions/--cwd--/timestamp_uuid.jsonl
  const sessionDir = resolve(sessionRoot, encodeCwd(cwd));
  await fs.mkdir(sessionDir, { recursive: true });

  const filename = `${timestamp.replace(/[:.]/g, "-")}_${id}.jsonl`;
  const file = resolve(sessionDir, filename);

  const header = { type: "session", version: 3, id, timestamp, cwd };
  await fs.writeFile(file, JSON.stringify(header) + "\n", "utf-8");
  return file;
}

export async function renameSession(file: string, newName: string) {
  const entry = {
    type: "name",
    id: randomUUID(),
    name: newName,
    timestamp: new Date().toISOString(),
  };
  await fs.appendFile(file, JSON.stringify(entry) + "\n", "utf-8");
}

export async function editMessage(
  file: string,
  messageId: string,
  newText: string,
) {
  const content = await fs.readFile(file, "utf-8");
  const lines = content.split("\n");
  let modified = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    try {
      const parsed = JSON.parse(line);
      if (
        parsed.type === "message" &&
        parsed.id === messageId &&
        parsed.message
      ) {
        // Find text content and edit it
        if (Array.isArray(parsed.message.content)) {
          const textItem = parsed.message.content.find(
            (c: any) => c.type === "text",
          );
          if (textItem) {
            textItem.text = newText;
            lines[i] = JSON.stringify(parsed);
            modified = true;
            break;
          }
        }
      }
    } catch (e) {
      // Ignore parse errors on individual lines
    }
  }

  if (modified) {
    await fs.writeFile(file, lines.join("\n"), "utf-8");
  }
}
