import { promises as fs, type Stats } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, extname, resolve, sep } from "node:path";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { localDateKey } from "./utils";
import type { MessagePart, SessionTreeNode, Usage } from "@/types";

const sessionRoot = resolve(
  process.env.PI_SESSION_DIR || `${homedir()}/.pi/agent/sessions`,
);
const terminal = process.env.PI_TERMINAL || "x-terminal-emulator";
const piCommand = process.env.PI_COMMAND || "pi";
const configuredMaxBytes = Number(process.env.PI_SESSION_BROWSER_MAX_BYTES);
// A garbage value would make every size comparison false and silently turn
// the safety limit off, so only a real positive number counts.
export const maxSessionBytes =
  Number.isFinite(configuredMaxBytes) && configuredMaxBytes > 0
    ? configuredMaxBytes
    : 100 * 1024 * 1024;
let canonicalRoot: string;

/**
 * One parsed JSONL line. The format is Pi's; only the fields this browser
 * reads are typed, and every one is optional because any line can be
 * anything.
 */
type SessionEntry = {
  type?: string;
  id?: string;
  parentId?: string | null;
  timestamp?: string;
  name?: string;
  summary?: string;
  cwd?: string;
  version?: number;
  targetId?: string;
  label?: string;
  /** compaction and branch_summary carry usage/tokensBefore on the entry. */
  usage?: unknown;
  tokensBefore?: number;
  message?: {
    role?: string;
    content?: unknown;
    timestamp?: string;
    toolName?: string;
    toolCallId?: string;
    isError?: boolean;
    details?: unknown;
    display?: boolean;
    model?: string;
    provider?: string;
    usage?: unknown;
    stopReason?: string;
    errorMessage?: string;
    command?: string;
    output?: string;
    exitCode?: number | null;
    cancelled?: boolean;
    truncated?: boolean;
  };
};

type ContentPart = {
  type?: string;
  text?: string;
  name?: string;
  thinking?: string;
  id?: string;
  arguments?: unknown;
  data?: string;
  mimeType?: string;
};

function textFrom(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return (content as ContentPart[])
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

/** The structured counterpart of textFrom — what the chat view renders. */
function partsFrom(content: unknown): MessagePart[] | undefined {
  if (!Array.isArray(content)) return undefined;
  const parts: MessagePart[] = [];
  for (const raw of content as ContentPart[]) {
    if (raw?.type === "text" && typeof raw.text === "string")
      parts.push({ type: "text", text: raw.text });
    else if (raw?.type === "thinking" && typeof raw.thinking === "string")
      parts.push({ type: "thinking", thinking: raw.thinking });
    else if (raw?.type === "toolCall")
      parts.push({
        type: "toolCall",
        id: raw.id,
        name: raw.name,
        arguments:
          raw.arguments && typeof raw.arguments === "object"
            ? (raw.arguments as Record<string, unknown>)
            : undefined,
      });
    else if (raw?.type === "image" && typeof raw.data === "string")
      parts.push({ type: "image", data: raw.data, mimeType: raw.mimeType });
  }
  return parts;
}

/** Passes usage through with every field checked — any line can be anything. */
function usageFrom(raw: unknown): Usage | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const source = raw as Record<string, unknown>;
  const num = (value: unknown) =>
    typeof value === "number" && Number.isFinite(value) ? value : undefined;
  const total =
    source.cost && typeof source.cost === "object"
      ? num((source.cost as Record<string, unknown>).total)
      : undefined;
  const usage: Usage = {
    input: num(source.input),
    output: num(source.output),
    cacheRead: num(source.cacheRead),
    cacheWrite: num(source.cacheWrite),
    totalTokens: num(source.totalTokens),
    ...(total !== undefined ? { cost: { total } } : {}),
  };
  return Object.values(usage).some((value) => value !== undefined)
    ? usage
    : undefined;
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

export function parseEntries(raw: string) {
  const entries: SessionEntry[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line));
    } catch {
      /* A partially-written final JSONL line is safe to ignore. */
    }
  }
  return entries;
}

async function load(file: string) {
  const stat = await fs.stat(file);
  if (stat.size > maxSessionBytes)
    throw new Error(
      `Session is larger than the ${Math.round(maxSessionBytes / 1024 / 1024)} MB safety limit.`,
    );
  const raw = await fs.readFile(file, "utf8");
  return { stat, entries: parseEntries(raw) };
}

/**
 * The name update an entry carries: a string, null for an explicit clear,
 * undefined when the entry is not name-bearing. Pi names sessions with
 * session_info entries; earlier versions of this browser wrote "name"
 * entries instead, so those still count.
 */
export function nameFromEntry(entry: SessionEntry): string | null | undefined {
  if (entry.type !== "session_info" && entry.type !== "name") return undefined;
  return entry.name?.trim() || null;
}

/** The latest name-bearing entry wins; an empty name clears the title. */
function nameFrom(entries: SessionEntry[]) {
  for (let i = entries.length - 1; i >= 0; i--) {
    const name = nameFromEntry(entries[i]);
    if (name !== undefined) return name;
  }
  return null;
}

function summarize(file: string, stat: Stats, entries: SessionEntry[]) {
  const header = entries.find((entry) => entry.type === "session") || {};
  const name = nameFrom(entries);
  const messages = entries.filter((entry) => entry.type === "message");
  const firstUser = messages.find((entry) => entry.message?.role === "user");
  const last = entries.at(-1);

  // Dollar cost accumulates from every usage-bearing entry: assistant turns,
  // tool-nested LLM work, compaction and branch summaries alike.
  let cost = 0;
  let hasError = false;
  for (const entry of entries) {
    const usage = usageFrom(
      entry.type === "message" ? entry.message?.usage : entry.usage,
    );
    if (usage?.cost?.total) cost += usage.cost.total;
    if (
      entry.message?.role === "assistant" &&
      (entry.message.stopReason === "error" || entry.message.errorMessage)
    )
      hasError = true;
  }

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
    cost,
    hasError,
    model: modelFromEntries(entries),
  };
}

/**
 * Pi encodes a session's cwd as its directory name: /home/pc -> --home-pc--.
 * Mirrors pi's own scheme exactly (session-manager.ts): only the first
 * leading separator is dropped, and "\" and ":" collapse to "-" too.
 */
function encodeCwd(cwd: string) {
  return `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
}

/**
 * The encoding is lossy — a "-" in a folder name is indistinguishable from a
 * separator — so this walks the real filesystem, taking the longest segment
 * that exists at each step. Only used for directories with no session to read
 * the cwd from. Only the literal "--" wrapper is stripped: a folder actually
 * named "--" contributes empty split parts the walk can still resolve. A tail
 * that no longer exists on disk is kept as one dash-joined segment — a
 * deleted leaf folder whose name contains dashes (cosmic-text) is far more
 * common than a deleted multi-level path.
 */
async function decodeDirName(name: string) {
  const parts = name.replace(/^--/, "").replace(/--$/, "").split("-");
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
    if (!matched) return `${path}/${parts.slice(i).join("-")}`;
    i = matched;
  }
  return path;
}

/** Reads the cwd out of a session's header line without loading the whole file. */
export async function readSessionCwd(file: string) {
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
 * Session files are append-only, so anything derived from one is valid for as
 * long as its (size, mtime) pair holds. These caches are what makes browsing
 * tens of thousands of sessions bearable: without them every timeline load
 * re-reads every session on disk.
 */
type Cached<T> = { size: number; mtimeMs: number; value: T };
const hasMessagesCache = new Map<string, Cached<boolean>>();
const summaryCache = new Map<string, Cached<ReturnType<typeof summarize>>>();

function cacheGet<T>(
  cache: Map<string, Cached<T>>,
  file: string,
  stat: { size: number; mtimeMs: number },
) {
  const cached = cache.get(file);
  return cached && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs
    ? cached
    : undefined;
}

function dropFromCaches(file: string) {
  hasMessagesCache.delete(file);
  summaryCache.delete(file);
  fileCwdCache.delete(file);
}

/** Promise.all with a cap on simultaneously open files. */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await fn(items[index]);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

// Anchored to a line start: the bare substring also matches inside any string
// field, such as a session named '…"type":"message"…'.
const MESSAGE_LINE = /^\{"type":"message"/m;
// A used session's first message appears early, so a bounded read answers
// almost every file without loading it whole.
const PROBE_BYTES = 64 * 1024;

async function probeForMessages(file: string, size: number) {
  // Nothing that large can be an untouched session, and reading it would hurt.
  if (size > maxSessionBytes) return true;
  let handle;
  try {
    handle = await fs.open(file, "r");
    const { buffer, bytesRead } = await handle.read({
      buffer: Buffer.alloc(Math.min(size, PROBE_BYTES)),
      position: 0,
    });
    if (MESSAGE_LINE.test(buffer.subarray(0, bytesRead).toString("utf8")))
      return true;
    if (size <= PROBE_BYTES) return false;
  } finally {
    await handle?.close();
  }
  const raw = await fs.readFile(file, "utf8");
  return MESSAGE_LINE.test(raw);
}

/**
 * A session Pi has never written a message to holds nothing worth browsing, so
 * it is left out of the listings entirely.
 */
async function hasMessages(file: string) {
  try {
    const stat = await fs.stat(file);
    const cached = cacheGet(hasMessagesCache, file, stat);
    if (cached) return cached.value;
    const value = await probeForMessages(file, stat.size);
    hasMessagesCache.set(file, {
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      value,
    });
    return value;
  } catch {
    return false;
  }
}

/** Header cwds never change once written, so one read per file suffices. */
const fileCwdCache = new Map<string, string>();

async function cachedFileCwd(file: string) {
  const known = fileCwdCache.get(file);
  if (known !== undefined) return known;
  const cwd = await readSessionCwd(file);
  if (cwd) fileCwdCache.set(file, cwd);
  return cwd;
}

/**
 * Sessions are grouped by the cwd each file's own header records — the
 * directory name is only a lossy fallback (pi turns "/" into "-", so
 * /a/b-c and /a/b/c share a directory). Grouping per file keeps sessions
 * from colliding cwds apart, and still merges directory-name variants of
 * the same path (--home-pc and --home-pc--) into a single location.
 */
async function locationIndex() {
  await initCanonicalRoot();
  let dirents;
  try {
    dirents = await fs.readdir(canonicalRoot, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT")
      return new Map<string, { files: string[]; used: boolean }>();
    throw error;
  }

  const dirs = dirents.filter((e) => e.isDirectory()).map((e) => e.name);
  const perDir = await Promise.all(
    dirs.map((name) =>
      walk(resolve(canonicalRoot, name)).catch(() => [] as string[]),
    ),
  );

  // Decoding walks the filesystem, so each directory resolves at most once,
  // and only when one of its files actually needs the fallback.
  const decoded = new Map<string, Promise<string>>();
  const pairs = dirs.flatMap((dir, i) => perDir[i].map((file) => ({ dir, file })));
  const cwds = await mapLimit(pairs, 16, async ({ dir, file }) => {
    const cwd = await cachedFileCwd(file);
    if (cwd) return cwd;
    let fallback = decoded.get(dir);
    if (!fallback) {
      fallback = decodeDirName(dir);
      decoded.set(dir, fallback);
    }
    return fallback;
  });

  const index = new Map<string, { files: string[]; used: boolean }>();
  pairs.forEach(({ file }, i) => {
    const entry = index.get(cwds[i]) || { files: [], used: false };
    entry.files.push(file);
    index.set(cwds[i], entry);
  });

  await Promise.all(
    [...index.values()].map(async (entry) => {
      for (const file of entry.files) {
        if (await hasMessages(file)) {
          entry.used = true;
          break;
        }
      }
    }),
  );
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
  if (!location) {
    try {
      return await walk(canonicalRoot);
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") throw error;
      return [];
    }
  }

  const index = await locationIndex();
  const entry = index.get(location);
  if (entry) return entry.files;

  // Older links carried the raw directory name rather than the cwd. Only an
  // actual top-level session directory qualifies, resolved through realpath
  // so a symlinked name cannot reach outside the root.
  const names = await fs
    .readdir(canonicalRoot, { withFileTypes: true })
    .then((dirents) => dirents.filter((e) => e.isDirectory()).map((e) => e.name))
    .catch(() => [] as string[]);
  if (!names.includes(location)) return [];
  const target = await fs
    .realpath(resolve(canonicalRoot, location))
    .catch(() => null);
  if (!target || !target.startsWith(`${canonicalRoot}${sep}`)) return [];
  return walk(target).catch(() => [] as string[]);
}

/** Session filenames start with a UTC stamp: 2026-08-09T19-28-48-916Z_uuid.jsonl */
export function timestampFromFilename(file: string): Date | null {
  const match = basename(file).match(
    /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/,
  );
  if (!match) return null;
  const [, date, h, m, s, ms] = match;
  const parsed = new Date(`${date}T${h}:${m}:${s}.${ms}Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export async function listDates(location?: string) {
  const all = await collectFiles(location);
  const used = await mapLimit(all, 16, hasMessages);
  const files = all.filter((_, i) => used[i]);

  const dates: Record<string, number> = {};
  for (const file of files) {
    const timestamp = timestampFromFilename(file);
    if (!timestamp) continue;
    const key = localDateKey(timestamp);
    dates[key] = (dates[key] || 0) + 1;
  }

  // The canonical YYYY-MM-DD keys sort chronologically as plain strings.
  return Object.entries(dates)
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * Session summaries for explicit files, unreadable ones skipped. Bounded
 * parallelism and (size, mtime)-keyed reuse: a day with hundreds of large
 * sessions would otherwise spike memory and file descriptors.
 */
export async function getSessionInfos(files: string[]) {
  const loaded = await mapLimit(files, 16, async (file) => {
    try {
      const known = cacheGet(summaryCache, file, await fs.stat(file));
      if (known) return known.value;
      const { stat, entries } = await load(file);
      const value = summarize(file, stat, entries);
      summaryCache.set(file, {
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        value,
      });
      return value;
    } catch (error) {
      console.warn(
        `Skipping ${file}: ${error instanceof Error ? error.message : error}`,
      );
      return null;
    }
  });
  return loaded.filter(
    (session): session is NonNullable<typeof session> => session !== null,
  );
}

export async function listSessions(targetDate?: string, location?: string) {
  let files = await collectFiles(location);

  if (targetDate) {
    // Links from before the canonical key carried locale-formatted dates;
    // parse those rather than turning old bookmarks into empty pages.
    const wanted = /^\d{4}-\d{2}-\d{2}$/.test(targetDate)
      ? targetDate
      : Number.isNaN(Date.parse(targetDate))
        ? null
        : localDateKey(new Date(targetDate));
    files = files.filter((file) => {
      const timestamp = timestampFromFilename(file);
      return timestamp !== null && localDateKey(timestamp) === wanted;
    });
  }

  return (await getSessionInfos(files))
    .filter((session) => session.messageCount > 0)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

/** A case-insensitive needle with ~80 chars of context around the hit. */
function snippetAround(haystack: string, needle: string) {
  const at = haystack.toLowerCase().indexOf(needle.toLowerCase());
  if (at === -1) return null;
  const start = Math.max(0, at - 40);
  const end = Math.min(haystack.length, at + needle.length + 60);
  return `${start > 0 ? "…" : ""}${haystack
    .slice(start, end)
    .replace(/\s+/g, " ")
    .trim()}${end < haystack.length ? "…" : ""}`;
}

/** Everything in a message worth matching a search against. */
function searchableTextOf(entry: SessionEntry) {
  const message = entry.message;
  if (!message) return "";
  if (message.role === "bashExecution")
    return [message.command, message.output].filter(Boolean).join("\n");
  const content = message.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return (content as ContentPart[])
    .map((part) => part?.text || part?.thinking || "")
    .filter(Boolean)
    .join("\n");
}

export type SearchResult = ReturnType<typeof summarize> & {
  snippet: string;
  matchedIn: "name" | "message";
  date: string | null;
};

/**
 * Full-text search across session files: a bounded line-scan, no index.
 * Matches session names and message text (including thinking and bash runs);
 * each file contributes its first hit.
 */
export async function searchSessions(
  query: string,
  location?: string,
  limit = 30,
) {
  const needle = query.trim();
  if (needle.length < 2) return [];
  const files = await collectFiles(location);

  let found = 0;
  const matches = await mapLimit(files, 16, async (file) => {
    if (found >= limit * 2) return null; // enough candidates to rank
    let loaded;
    try {
      loaded = await load(file);
    } catch {
      return null; // oversized or unreadable — skip, same as listings do
    }
    const { stat, entries } = loaded;
    const summary = summarize(file, stat, entries);
    if (summary.messageCount === 0) return null;

    let snippet: string | null = null;
    let matchedIn: SearchResult["matchedIn"] = "message";
    if (summary.name && snippetAround(summary.name, needle)) {
      snippet = summary.name;
      matchedIn = "name";
    } else {
      for (const entry of entries) {
        if (entry.type !== "message") continue;
        snippet = snippetAround(searchableTextOf(entry), needle);
        if (snippet) break;
      }
    }
    if (!snippet) return null;
    found++;
    const timestamp = timestampFromFilename(file);
    return {
      ...summary,
      snippet,
      matchedIn,
      date: timestamp ? localDateKey(timestamp) : null,
    } satisfies SearchResult;
  });

  return matches
    .filter((match): match is SearchResult => match !== null)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, limit);
}

/** Shapes one raw session entry into a renderable conversation item. */
export function conversationItemFromEntry(entry: SessionEntry) {
  if (entry.type === "message") {
    const message = entry.message || {};
    if (message.role === "custom" && !message.display) return null;
    if (message.role === "bashExecution") {
      // Bash runs carry the command itself instead of content parts.
      return {
        id: entry.id,
        timestamp: entry.timestamp || message.timestamp,
        role: "bashExecution",
        text: message.command ? `$ ${message.command}` : "[bash]",
        command: message.command,
        output: message.output,
        exitCode: message.exitCode,
        cancelled: message.cancelled,
        truncated: message.truncated,
      };
    }
    return {
      id: entry.id,
      timestamp: entry.timestamp || message.timestamp,
      role: message.role || "message",
      text: textFrom(message.content),
      parts: partsFrom(message.content),
      toolName: message.toolName,
      toolCallId: message.toolCallId,
      isError: message.isError,
      details: message.details,
      usage: usageFrom(message.usage),
      model: message.model,
      stopReason: message.stopReason,
      errorMessage: message.errorMessage,
    };
  }
  if (entry.type === "compaction") {
    return {
      id: entry.id,
      timestamp: entry.timestamp,
      role: "summary",
      text: entry.summary || "Conversation compacted",
      tokensBefore: entry.tokensBefore,
      usage: usageFrom(entry.usage),
    };
  }
  if (entry.type === "branch_summary") {
    return {
      id: entry.id,
      timestamp: entry.timestamp,
      role: "summary",
      text: entry.summary || "Branch summary",
      usage: usageFrom(entry.usage),
    };
  }
  return null;
}

export function conversationFromEntries(file: string, entries: SessionEntry[]) {
  const header = entries.find((entry) => entry.type === "session") || {};
  const name = nameFrom(entries);
  const items = [];
  for (const entry of entries) {
    const item = conversationItemFromEntry(entry);
    if (item) items.push(item);
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
    model: modelFromEntries(entries),
    items,
    preview,
  };
}

export async function getConversation(file: string) {
  const { entries } = await load(file);
  return conversationFromEntries(file, entries);
}

export async function launchSession(file: string) {
  const cwd = await readSessionCwd(file);
  if (!cwd) throw new Error("The session has no working directory.");

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
  dropFromCaches(file);
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

/**
 * Without a terminal to control, bash reports that job control is off. That is
 * exactly what we asked for, so it stays out of what the user is shown.
 */
function detailOf(stderr: string) {
  const detail = stderr
    .split("\n")
    .filter(
      (line) =>
        !/^bash: (cannot set terminal process group|no job control)/.test(
          line.trim(),
        ),
    )
    .join("\n")
    .trim();
  return detail ? ` ${detail}` : "";
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
    // Use an interactive shell (-ic) to ensure aliases (like 'pi') are expanded.
    // Pass file and message as environment variables to prevent shell injection;
    // PI_COMMAND itself is interpolated, which is acceptable only because it is
    // an operator-set env var — never route user input through it.
    // (This app is Linux-only; a Windows branch that passed the raw message to
    // cmd.exe via shell:true used to live here and must not come back.)
    const child = spawn(
      "bash",
      ["-ic", `${piCommand} --session "$PI_FILE" -p "$PI_MESSAGE"`],
      {
        stdio: ["ignore", "ignore", "pipe"],
        cwd,
        // Its own process group: an interactive shell claims the terminal it
        // is started from, and doing that from a background group suspends
        // everything in it — the server included.
        detached: true,
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
        reject(new Error(`Message failed to send. Code ${code}.${detailOf(stderr)}`));
      } else {
        done();
      }
    });
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

/**
 * Appends an entry in Pi's own tree format: an 8-char id chained to the
 * current leaf via parentId. Anything else is invisible to Pi when it
 * resumes the session.
 */
async function appendChainedEntry(
  file: string,
  fields: Record<string, unknown>,
) {
  const { entries } = await load(file);
  const ids = new Set(entries.map((entry) => entry.id));
  let id: string = randomUUID();
  for (let i = 0; i < 100; i++) {
    const candidate = randomUUID().slice(0, 8);
    if (!ids.has(candidate)) {
      id = candidate;
      break;
    }
  }
  const leaf = entries.findLast(
    (entry) => entry.type !== "session" && entry.id,
  );
  const entry = {
    ...fields,
    id,
    parentId: leaf?.id ?? null,
    timestamp: new Date().toISOString(),
  };
  await fs.appendFile(file, JSON.stringify(entry) + "\n", "utf-8");
}

/**
 * The /fork counterpart, matching pi's SessionManager.forkFrom: a new file in
 * the same session directory with a fresh id and timestamp, a header whose
 * parentSession points at the source, and every non-header entry copied —
 * the whole tree, unlike /clone which takes only the active branch.
 */
export async function forkSession(file: string) {
  const { entries } = await load(file);
  const header = entries.find((entry) => entry.type === "session");
  if (!header) throw new Error("Cannot fork: the session has no header.");

  const id = randomUUID();
  const timestamp = new Date().toISOString();
  const newHeader = {
    type: "session",
    version: header.version ?? 3,
    id,
    timestamp,
    cwd: header.cwd,
    parentSession: file,
  };
  const target = resolve(
    dirname(file),
    `${timestamp.replace(/[:.]/g, "-")}_${id}.jsonl`,
  );
  const lines = [
    JSON.stringify(newHeader),
    ...entries
      .filter((entry) => entry.type !== "session")
      .map((entry) => JSON.stringify(entry)),
  ];
  // wx: a fork must never overwrite anything.
  await fs.writeFile(target, lines.join("\n") + "\n", {
    encoding: "utf-8",
    flag: "wx",
  });
  return target;
}

/** The id of the entry pi would treat as the current leaf: the file's last. */
function leafIdOf(entries: SessionEntry[]) {
  return entries.findLast((entry) => entry.type !== "session" && entry.id)?.id;
}

/** Root-to-target ancestry chain of an entry, via the parentId links. */
function branchPath(entries: SessionEntry[], targetId: string) {
  const byId = new Map(
    entries.filter((entry) => entry.id).map((entry) => [entry.id!, entry]),
  );
  const path: SessionEntry[] = [];
  let current = byId.get(targetId);
  if (!current) throw new Error(`No entry ${targetId} in this session.`);
  while (current) {
    path.push(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return path.reverse();
}

/**
 * The /clone and fork-from-entry counterpart, matching pi's
 * createBranchedSession: only the ancestry path of the target entry survives
 * (the leaf by default — the active branch), re-chained linearly with labels
 * re-attached, in a new file whose header points back at the source.
 */
export async function branchSessionAt(file: string, entryId?: string) {
  const { entries } = await load(file);
  const header = entries.find((entry) => entry.type === "session");
  if (!header) throw new Error("Cannot clone: the session has no header.");
  const targetId = entryId ?? leafIdOf(entries);
  if (!targetId) throw new Error("Nothing to clone yet.");

  // Labels are re-created from the resolved map: keeping them in the path
  // would leave entries chained through labels that may not survive.
  const path = branchPath(entries, targetId).filter(
    (entry) => entry.type !== "label",
  );
  let parentId: string | null = null;
  const rechained = path.map((entry) => {
    const copy = { ...entry, parentId };
    parentId = entry.id!;
    return copy;
  });

  const pathIds = new Set(path.map((entry) => entry.id));
  const labels = entries.filter(
    (entry) =>
      entry.type === "label" && entry.targetId && pathIds.has(entry.targetId),
  );
  const labelEntries = labels.map((entry) => {
    const copy = { ...entry, parentId };
    parentId = entry.id!;
    return copy;
  });

  const id = randomUUID();
  const timestamp = new Date().toISOString();
  const newHeader = {
    type: "session",
    version: header.version ?? 3,
    id,
    timestamp,
    cwd: header.cwd,
    parentSession: file,
  };
  const target = resolve(
    dirname(file),
    `${timestamp.replace(/[:.]/g, "-")}_${id}.jsonl`,
  );
  const lines = [newHeader, ...rechained, ...labelEntries].map((entry) =>
    JSON.stringify(entry),
  );
  await fs.writeFile(target, lines.join("\n") + "\n", {
    encoding: "utf-8",
    flag: "wx",
  });
  return target;
}

/**
 * The conversation as a tree for the /tree view: every displayable item,
 * parented to its nearest displayable ancestor (change entries and names sit
 * between them in the chain), with pi's active path — the ancestry of the
 * file's last entry — marked.
 */
export async function getSessionTree(file: string) {
  const { entries } = await load(file);
  const byId = new Map(
    entries.filter((entry) => entry.id).map((entry) => [entry.id!, entry]),
  );

  const itemIds = new Set<string>();
  const paired: { entry: SessionEntry; item: NonNullable<ReturnType<typeof conversationItemFromEntry>> }[] = [];
  for (const entry of entries) {
    const item = conversationItemFromEntry(entry);
    if (item && entry.id) {
      itemIds.add(entry.id);
      paired.push({ entry, item });
    }
  }

  const nearestItemAncestor = (entry: SessionEntry) => {
    let walk = entry.parentId ?? null;
    while (walk && !itemIds.has(walk)) {
      walk = byId.get(walk)?.parentId ?? null;
    }
    return walk;
  };

  const active = new Set<string>();
  const leafId = leafIdOf(entries);
  if (leafId) {
    for (const entry of branchPath(entries, leafId)) {
      if (entry.id && itemIds.has(entry.id)) active.add(entry.id);
    }
  }

  const nodes: SessionTreeNode[] = paired.map(({ entry, item }) => ({
    id: entry.id!,
    parentId: nearestItemAncestor(entry),
    role: item.role,
    text: short(item.text || "", 120),
    timestamp: item.timestamp,
    toolName: item.toolName,
    active: active.has(entry.id!),
  }));

  const leafItem = [...active].at(-1) ?? null;
  return { nodes, leafId: leafItem };
}

export async function renameSession(file: string, newName: string) {
  await appendChainedEntry(file, {
    type: "session_info",
    name: newName.replace(/[\r\n]+/g, " ").trim(),
  });
}

/**
 * Pi restores a session's model from the last model_change entry (or
 * assistant message) on the active path, so appending one is the native way
 * to switch the model the next `pi --session … -p` run will use.
 */
export async function appendModelChange(
  file: string,
  provider: string,
  modelId: string,
) {
  await appendChainedEntry(file, { type: "model_change", provider, modelId });
}

export async function appendThinkingLevelChange(
  file: string,
  thinkingLevel: string,
) {
  await appendChainedEntry(file, { type: "thinking_level_change", thinkingLevel });
}

/** The model the session is currently on, mirroring Pi's own restore rule. */
export function modelFromEntries(entries: SessionEntry[]) {
  let model: { provider: string; modelId: string } | null = null;
  for (const entry of entries) {
    if (entry.type === "model_change") {
      const change = entry as { provider?: string; modelId?: string };
      if (change.provider && change.modelId)
        model = { provider: change.provider, modelId: change.modelId };
    } else if (entry.type === "message" && entry.message?.role === "assistant") {
      const message = entry.message as { provider?: string; model?: string };
      if (message.provider && message.model)
        model = { provider: message.provider, modelId: message.model };
    }
  }
  return model;
}

/** An edit that could not land, with the HTTP status that describes why. */
export class SessionEditError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function editMessage(
  file: string,
  messageId: string,
  newText: string,
) {
  const before = await fs.stat(file);
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
        const messageContent = parsed.message.content;
        if (typeof messageContent === "string") {
          parsed.message.content = newText;
        } else {
          const textItem = Array.isArray(messageContent)
            ? (messageContent as ContentPart[]).find((c) => c?.type === "text")
            : null;
          if (!textItem)
            throw new SessionEditError(
              "That message has no editable text.",
              422,
            );
          textItem.text = newText;
        }
        lines[i] = JSON.stringify(parsed);
        modified = true;
        break;
      }
    } catch (error) {
      if (error instanceof SessionEditError) throw error;
      /* A malformed line is skipped, matching how sessions are read. */
    }
  }

  if (!modified)
    throw new SessionEditError("No message with that id in this session.", 404);

  // Pi may be appending to this session right now; a plain rewrite would
  // silently drop every line it added after our read. Stage the edit in a
  // temp file, re-check that the session is untouched, and rename into place.
  const temp = `${file}.edit-${randomUUID().slice(0, 8)}.tmp`;
  await fs.writeFile(temp, lines.join("\n"), "utf-8");
  const after = await fs.stat(file).catch(() => null);
  if (
    !after ||
    after.size !== before.size ||
    after.mtimeMs !== before.mtimeMs
  ) {
    await fs.unlink(temp).catch(() => {});
    throw new SessionEditError(
      "The session changed while it was being edited. Try again.",
      409,
    );
  }
  await fs.rename(temp, file);
}
