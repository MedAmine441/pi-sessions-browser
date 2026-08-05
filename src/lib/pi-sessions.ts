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

export async function getLocations() {
  await initCanonicalRoot();
  try {
    const entries = await fs.readdir(canonicalRoot, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch (error: any) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

export function getDefaultLocation() {
  return homedir().replace(/\//g, "-").replace(/^-+/, "--");
}

export async function listDates(location?: string) {
  await initCanonicalRoot();
  let files;
  try {
    const targetDir = location
      ? resolve(canonicalRoot, location)
      : canonicalRoot;
    const safeTarget = await fs.realpath(targetDir).catch(() => null);
    if (!safeTarget || !safeTarget.startsWith(canonicalRoot)) {
      return [];
    }
    files = await walk(safeTarget);
  } catch (error: any) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }

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
  await initCanonicalRoot();
  let files;
  try {
    const targetDir = location
      ? resolve(canonicalRoot, location)
      : canonicalRoot;
    const safeTarget = await fs.realpath(targetDir).catch(() => null);
    if (!safeTarget || !safeTarget.startsWith(canonicalRoot)) {
      return [];
    }
    files = await walk(safeTarget);
  } catch (error: any) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }

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
    .filter(Boolean)
    .sort(
      (a: any, b: any) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
    );
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
  return new Promise<void>((resolve, reject) => {
    const isWin = process.platform === "win32";
    if (isWin) {
      const child = spawn(piCommand, ["--session", file, "-p", message], {
        stdio: "ignore",
        env: process.env,
        shell: true,
      });
      child.once("error", (error) => reject(error));
      child.once("close", (code) => {
        if (code !== 0 && code !== null)
          reject(new Error(`Process exited with code ${code}`));
        else resolve();
      });
    } else {
      // Use an interactive shell (-ic) to ensure aliases (like 'pi') are expanded.
      // Pass file and message as environment variables to prevent shell injection.
      const child = spawn(
        "bash",
        ["-ic", `${piCommand} --session "$PI_FILE" -p "$PI_MESSAGE"`],
        {
          stdio: ["ignore", "ignore", "pipe"],
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
          resolve();
        }
      });
    }
  });
}

export async function createNewSessionFile(targetCwd?: string) {
  await initCanonicalRoot();
  const cwd = targetCwd || homedir();
  const id = randomUUID();
  const timestamp = new Date().toISOString();

  // Format matches standard pi session path: ~/.pi/agent/sessions/--cwd--/timestamp_uuid.jsonl
  const encodedCwd = cwd.replace(/\//g, "-").replace(/^-+/, "--");
  const sessionDir = resolve(sessionRoot, encodedCwd);
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
