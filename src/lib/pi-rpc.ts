import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

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
