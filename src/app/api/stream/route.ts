import { NextResponse } from 'next/server';
import { safeSessionPath, getConversation } from '@/lib/pi-sessions';
import { watch } from 'node:fs';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const file = searchParams.get('file');
  if (!file) return new Response('Missing file', { status: 400 });

  let safePath: string;
  try {
    safePath = await safeSessionPath(file);
  } catch {
    return new Response('Invalid file', { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let timeout: NodeJS.Timeout | null = null;
      let watcher: any = null;

      const pushUpdate = async () => {
        try {
          const detail = await getConversation(safePath);
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(detail)}\n\n`));
        } catch (e) {
          // File might have been deleted, or parse error
        }
      };

      // Push initial state immediately
      await pushUpdate();

      try {
        watcher = watch(safePath, (eventType) => {
          if (eventType === 'change') {
            if (timeout) clearTimeout(timeout);
            timeout = setTimeout(async () => {
              await pushUpdate();
            }, 50); // Small debounce
          }
        });
      } catch (err) {
        // Fallback or error if watch fails
        console.error("Failed to watch file", safePath, err);
      }

      // Keep alive heartbeat
      const heartbeat = setInterval(() => {
        controller.enqueue(encoder.encode(`: heartbeat\n\n`));
      }, 15000);

      request.signal.addEventListener('abort', () => {
        if (watcher) watcher.close();
        if (timeout) clearTimeout(timeout);
        clearInterval(heartbeat);
      });
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
