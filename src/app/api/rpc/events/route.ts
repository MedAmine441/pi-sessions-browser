import { safeSessionPath } from "@/lib/pi-sessions";
import { subscribeRpcEvents } from "@/lib/pi-rpc";

type StreamPayload = Record<string, unknown> & { kind: string };

/**
 * SSE relay of pi's RPC event stream, mapped to the handful of shapes the
 * chat view renders: token deltas for the live bubble, status changes for
 * the activity line. Listening does not spawn pi — only a prompt does.
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
    start(controller) {
      let closed = false;
      const send = (payload: StreamPayload) => {
        if (closed || request.signal.aborted) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
        } catch {
          /* client vanished between the check and the enqueue */
        }
      };

      const unsubscribe = subscribeRpcEvents(safePath, (event) => {
        switch (event.type) {
          case "message_update":
            send({ kind: "delta", event: event.assistantMessageEvent });
            return;
          case "message_start": {
            const role = (event.message as { role?: string } | undefined)?.role;
            if (role === "assistant") send({ kind: "message_start" });
            return;
          }
          case "message_end":
            send({ kind: "message_end" });
            return;
          case "agent_start":
            send({ kind: "status", state: "streaming" });
            return;
          case "agent_settled":
            send({ kind: "status", state: "idle" });
            return;
          case "tool_execution_start":
            send({
              kind: "status",
              state: "tool",
              toolName: typeof event.toolName === "string" ? event.toolName : "tool",
            });
            return;
          case "tool_execution_end":
            send({ kind: "status", state: "streaming" });
            return;
          case "compaction_start":
            send({ kind: "status", state: "compacting" });
            return;
          case "compaction_end":
            send({ kind: "status", state: "streaming" });
            return;
          case "auto_retry_start":
            send({ kind: "status", state: "retrying" });
            return;
          case "auto_retry_end":
            send({ kind: "status", state: "streaming" });
            return;
          case "rpc_closed":
            send({ kind: "closed" });
            return;
        }
      });

      const heartbeat = setInterval(() => {
        if (closed || request.signal.aborted) return;
        try {
          controller.enqueue(encoder.encode(`: heartbeat\n\n`));
        } catch {
          /* closing */
        }
      }, 15000);

      request.signal.addEventListener("abort", () => {
        if (closed) return;
        closed = true;
        unsubscribe();
        clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
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
