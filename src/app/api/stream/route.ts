import { watch, promises as fs } from "node:fs";
import {
  safeSessionPath,
  conversationFromEntries,
  conversationItemFromEntry,
  modelFromEntries,
  nameFromEntry,
  parseEntries,
  maxSessionBytes,
} from "@/lib/pi-sessions";

/**
 * Streams a session to the chat view. The first event is a full snapshot;
 * after that only the bytes Pi appends are read and parsed, and the client
 * merges the new items by id — re-serializing the whole conversation on every
 * append is O(n²) while Pi streams output.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const file = searchParams.get("file");
  if (!file) return new Response("Missing file", { status: 400 });

  let safePath: string;
  try {
    safePath = await safeSessionPath(file);
  } catch {
    return new Response("Invalid file", { status: 400 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      let watcher: ReturnType<typeof watch> | null = null;
      let debounce: NodeJS.Timeout | null = null;
      let heartbeat: NodeJS.Timeout | null = null;
      /** Bytes of the file already parsed and pushed to the client. */
      let offset = 0;
      /** Reads are chained so two watcher events can never race the offset. */
      let reading: Promise<void> = Promise.resolve();

      const enqueue = (text: string) => {
        if (closed || request.signal.aborted) return;
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          /* The client vanished between the abort check and the enqueue. */
        }
      };
      const send = (payload: unknown) =>
        enqueue(`data: ${JSON.stringify(payload)}\n\n`);

      const shutdown = (notifyGone = false) => {
        if (closed) return;
        if (notifyGone) send({ kind: "gone" });
        closed = true;
        watcher?.close();
        if (debounce) clearTimeout(debounce);
        if (heartbeat) clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          /* Already closed by the abort. */
        }
      };

      const snapshot = async () => {
        const stat = await fs.stat(safePath);
        // The safety limit still applies; nothing more will ever be sent, so
        // say so rather than leaving the client on "initializing" forever.
        if (stat.size > maxSessionBytes) return shutdown(true);
        const buffer = await fs.readFile(safePath);
        // Only complete lines count; a partially-written last line stays
        // ahead of the offset so the next delta re-reads it whole.
        const end = buffer.lastIndexOf(0x0a) + 1;
        offset = end;
        const entries = parseEntries(buffer.subarray(0, end).toString("utf8"));
        send({ kind: "snapshot", detail: conversationFromEntries(safePath, entries) });
      };

      const delta = async () => {
        const stat = await fs.stat(safePath);
        // Smaller than what was already pushed means the file was rewritten
        // (a message edit); start over from a fresh snapshot.
        if (stat.size < offset) return snapshot();
        if (stat.size === offset) return;
        const handle = await fs.open(safePath, "r");
        try {
          const { buffer, bytesRead } = await handle.read({
            buffer: Buffer.alloc(stat.size - offset),
            position: offset,
          });
          const data = buffer.subarray(0, bytesRead);
          const end = data.lastIndexOf(0x0a) + 1;
          if (end === 0) return;
          const items = [];
          let name: string | null | undefined;
          const appended = parseEntries(data.subarray(0, end).toString("utf8"));
          for (const entry of appended) {
            const renamed = nameFromEntry(entry);
            if (renamed !== undefined) name = renamed;
            const item = conversationItemFromEntry(entry);
            if (item) items.push(item);
          }
          // A model_change entry or a fresh assistant message moves the
          // session onto a (possibly) different model.
          const model = modelFromEntries(appended) ?? undefined;
          offset += end;
          if (items.length || name !== undefined || model !== undefined)
            send({ kind: "append", items, name, model });
        } finally {
          await handle.close();
        }
      };

      const read = (task: () => Promise<void>) => {
        reading = reading
          .then(() => (closed ? undefined : task()))
          .catch((error: unknown) => {
            // The file disappearing mid-read means the session is gone.
            if ((error as NodeJS.ErrnoException)?.code === "ENOENT")
              shutdown(true);
          });
        return reading;
      };

      const arm = () => {
        watcher?.close();
        watcher = watch(safePath, (eventType) => {
          if (closed) return;
          if (eventType === "rename") {
            // On Linux a delete — or an atomic replace, like this app's own
            // message edits — surfaces as "rename", and the watcher is dead
            // afterwards. Re-arm on the path if a file is still there;
            // report the session gone if not.
            read(async () => {
              await fs.stat(safePath);
              arm();
              await snapshot();
            });
            return;
          }
          if (debounce) clearTimeout(debounce);
          debounce = setTimeout(() => read(delta), 50);
        });
      };

      await read(snapshot);

      try {
        if (!closed) arm();
      } catch (error) {
        console.error("Failed to watch file", safePath, error);
      }

      heartbeat = setInterval(() => enqueue(`: heartbeat\n\n`), 15000);

      request.signal.addEventListener("abort", () => shutdown());
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
