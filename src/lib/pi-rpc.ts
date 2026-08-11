import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { readSessionCwd } from "./pi-sessions";

const piCommand = process.env.PI_COMMAND || "pi";

/**
 * Runs one command against pi's RPC mode (`pi --mode rpc --session <file>`):
 * JSONL on stdin, id-correlated `{type:"response"}` lines on stdout with
 * events interleaved. This is how /compact and /export stay pi's own
 * machinery instead of a reimplementation. The process is one-shot: command
 * in, response out, stdin closed (pi's shutdown signal), hard kill as backup.
 */
export async function runPiRpc<T>(
  file: string,
  command: { type: string } & Record<string, unknown>,
  timeoutMs = 10 * 60 * 1000,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = randomUUID().slice(0, 8);
    // Same spawn shape as sendChatMessage: an interactive shell so a
    // PI_COMMAND alias resolves, its own process group so the shell can't
    // claim the server's terminal — and so cleanup can kill the whole tree.
    const child = spawn(
      "bash",
      ["-ic", `${piCommand} --mode rpc --session "$PI_FILE"`],
      {
        stdio: ["pipe", "pipe", "pipe"],
        detached: true,
        env: { ...process.env, PI_FILE: file },
      },
    );

    let stderr = "";
    let buffer = "";
    let settled = false;

    const cleanup = () => {
      child.stdin?.end();
      const killTimer = setTimeout(() => {
        try {
          process.kill(-child.pid!, "SIGKILL");
        } catch {
          /* already gone */
        }
      }, 2000);
      child.once("close", () => clearTimeout(killTimer));
      try {
        process.kill(-child.pid!, "SIGTERM");
      } catch {
        child.kill();
      }
    };
    const finish = (settle: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanup();
      settle();
    };
    const fail = (error: Error) => finish(() => reject(error));
    const timer = setTimeout(
      () => fail(new Error(`pi did not answer within ${timeoutMs / 1000}s.`)),
      timeoutMs,
    );

    child.stderr?.on("data", (data) => (stderr += data.toString()));
    child.stdout?.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      let newline;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (!line.trim()) continue;
        try {
          const message = JSON.parse(line);
          if (message?.type === "response" && message.id === id) {
            if (message.success) finish(() => resolve(message.data as T));
            else fail(new Error(message.error || `pi could not run ${command.type}.`));
          }
        } catch {
          /* Interleaved events and partial writes are not ours to parse. */
        }
      }
    });

    child.once("error", (error) => fail(error));
    child.once("close", () => {
      if (!settled) {
        const detail = stderr
          .split("\n")
          .filter((l) => l.trim() && !/cannot set terminal process group|no job control/.test(l))
          .slice(-3)
          .join(" ");
        fail(new Error(`pi exited before answering.${detail ? ` ${detail}` : ""}`));
      }
    });

    child.stdin.write(JSON.stringify({ id, ...command }) + "\n");
    // stdin stays open until the response arrives: closing it is pi's
    // shutdown signal and could abort the command mid-flight.
  });
}

/* ── Persistent RPC chat sessions ───────────────────────────────────────
 * One long-lived `pi --mode rpc` process per open chat: prompts stream
 * token deltas through the event stream, abort works mid-run, and the
 * session file keeps receiving pi's own writes (which the file-watch SSE
 * already relays). The one-shot runPiRpc above stays for compact/export,
 * which must work even when no chat process is up.
 */

type RpcEvent = { type: string } & Record<string, unknown>;
type RpcListener = (event: RpcEvent) => void;

const IDLE_SHUTDOWN_MS = 10 * 60 * 1000;
const RESPONSE_TIMEOUT_MS = 60 * 1000;

/** Listeners are keyed by file so an SSE can attach before pi is spawned. */
const listenersByFile = new Map<string, Set<RpcListener>>();

function broadcast(file: string, event: RpcEvent) {
  for (const listener of listenersByFile.get(file) || []) {
    try {
      listener(event);
    } catch {
      /* one bad listener must not stall the stream */
    }
  }
}

export function subscribeRpcEvents(file: string, listener: RpcListener) {
  let set = listenersByFile.get(file);
  if (!set) {
    set = new Set();
    listenersByFile.set(file, set);
  }
  set.add(listener);
  return () => {
    set.delete(listener);
    if (set.size === 0) listenersByFile.delete(file);
  };
}

class RpcChatSession {
  private child: ChildProcess;
  private buffer = "";
  private stderr = "";
  private pending = new Map<
    string,
    { resolve: (data: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }
  >();
  private idleTimer: NodeJS.Timeout | null = null;
  closed = false;

  constructor(
    readonly file: string,
    cwd: string,
  ) {
    // Same spawn shape as runPiRpc: interactive shell so a PI_COMMAND alias
    // resolves, own process group so the whole tree can be killed.
    this.child = spawn(
      "bash",
      ["-ic", `${piCommand} --mode rpc --session "$PI_FILE"`],
      {
        stdio: ["pipe", "pipe", "pipe"],
        detached: true,
        cwd,
        env: { ...process.env, PI_FILE: file },
      },
    );
    this.child.stderr?.on("data", (data) => {
      this.stderr = (this.stderr + data.toString()).slice(-2000);
    });
    this.child.stdout?.on("data", (chunk: Buffer) => this.onData(chunk));
    this.child.once("error", (error) => this.shutdown(error));
    this.child.once("close", () =>
      this.shutdown(new Error("pi's RPC process exited.")),
    );
    this.armIdleTimer();
  }

  private onData(chunk: Buffer) {
    this.armIdleTimer();
    this.buffer += chunk.toString("utf8");
    let newline;
    while ((newline = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      if (!line.trim()) continue;
      let message: RpcEvent;
      try {
        message = JSON.parse(line);
      } catch {
        continue; // partial writes are not ours to parse
      }
      if (message?.type === "response" && typeof message.id === "string") {
        const waiter = this.pending.get(message.id);
        if (waiter) {
          this.pending.delete(message.id);
          clearTimeout(waiter.timer);
          if (message.success) waiter.resolve(message.data);
          else
            waiter.reject(
              new Error(String(message.error || "pi rejected the command.")),
            );
        }
        continue;
      }
      broadcast(this.file, message);
    }
  }

  private armIdleTimer() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(
      () => this.shutdown(new Error("RPC session idled out.")),
      IDLE_SHUTDOWN_MS,
    );
  }

  send<T>(command: { type: string } & Record<string, unknown>): Promise<T> {
    if (this.closed) return Promise.reject(new Error("RPC session is closed."));
    this.armIdleTimer();
    const id = randomUUID().slice(0, 8);
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`pi did not answer within ${RESPONSE_TIMEOUT_MS / 1000}s.`));
      }, RESPONSE_TIMEOUT_MS);
      this.pending.set(id, {
        resolve: (data) => resolve(data as T),
        reject,
        timer,
      });
      this.child.stdin?.write(JSON.stringify({ id, ...command }) + "\n");
    });
  }

  shutdown(reason?: Error) {
    if (this.closed) return;
    this.closed = true;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    for (const [, waiter] of this.pending) {
      clearTimeout(waiter.timer);
      waiter.reject(reason || new Error("RPC session closed."));
    }
    this.pending.clear();
    if (rpcSessions.get(this.file) === this) rpcSessions.delete(this.file);
    broadcast(this.file, { type: "rpc_closed" });
    this.child.stdin?.end();
    const pid = this.child.pid;
    if (pid) {
      const killTimer = setTimeout(() => {
        try {
          process.kill(-pid, "SIGKILL");
        } catch {
          /* already gone */
        }
      }, 2000);
      this.child.once("close", () => clearTimeout(killTimer));
      try {
        process.kill(-pid, "SIGTERM");
      } catch {
        this.child.kill();
      }
    }
  }

  lastStderr() {
    return this.stderr
      .split("\n")
      .filter(
        (l) =>
          l.trim() &&
          !/cannot set terminal process group|no job control/.test(l),
      )
      .slice(-3)
      .join(" ");
  }
}

const rpcSessions = new Map<string, RpcChatSession>();

/** The live RPC session for a file, spawning one when asked to. */
export async function getRpcSession(file: string, create = false) {
  const existing = rpcSessions.get(file);
  if (existing && !existing.closed) return existing;
  if (!create) return null;
  const recorded = await readSessionCwd(file);
  const cwd =
    recorded &&
    (await fs
      .stat(recorded)
      .then((s) => s.isDirectory())
      .catch(() => false))
      ? recorded
      : homedir();
  const session = new RpcChatSession(file, cwd);
  rpcSessions.set(file, session);
  return session;
}

export function closeRpcSession(file: string) {
  rpcSessions.get(file)?.shutdown();
}

/* Detached process groups outlive a dying server unless killed explicitly.
   The global guard keeps dev-mode module reloads from stacking handlers. */
const CLEANUP_KEY = Symbol.for("pi-session-browser.rpc-cleanup");
const globalState = globalThis as { [CLEANUP_KEY]?: boolean };
if (!globalState[CLEANUP_KEY]) {
  globalState[CLEANUP_KEY] = true;
  const killAll = () => {
    for (const session of rpcSessions.values()) session.shutdown();
  };
  process.once("exit", killAll);
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      killAll();
      process.exit(0);
    });
  }
}
