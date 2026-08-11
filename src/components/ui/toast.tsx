"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import { Button } from "@/components/ui/button";

const TOAST_EVENT = "pi-sessions:toast";

type Toast = { id: number; message: string };

/**
 * Shows a transient error message. Replaces alert(), which blocks the whole
 * renderer process in Electron.
 */
export function toast(message: string) {
  window.dispatchEvent(new CustomEvent(TOAST_EVENT, { detail: message }));
}

let nextId = 1;

export function Toaster() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    const onToast = (event: Event) => {
      const message = String((event as CustomEvent).detail ?? "");
      if (!message) return;
      const id = nextId++;
      setToasts((prev) => [...prev, { id, message }]);
      setTimeout(
        () => setToasts((prev) => prev.filter((t) => t.id !== id)),
        6000,
      );
    };
    window.addEventListener(TOAST_EVENT, onToast);
    return () => window.removeEventListener(TOAST_EVENT, onToast);
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div
      className="fixed bottom-6 left-1/2 z-100 flex w-full max-w-md -translate-x-1/2 flex-col gap-2 px-4"
      role="region"
      aria-label="Notifications"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          role="alert"
          className="flex items-start gap-3 rounded-2xl border border-red-500/30 bg-stone-950/90 px-4 py-3 text-sm text-red-200 shadow-[0_10px_40px_rgba(0,0,0,0.6)] backdrop-blur-xl animate-in fade-in slide-in-from-bottom-4"
        >
          <AlertTriangle
            className="mt-0.5 h-4 w-4 shrink-0 text-red-400"
            aria-hidden="true"
          />
          <p className="min-w-0 flex-1 wrap-break-word">{t.message}</p>
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() =>
              setToasts((prev) => prev.filter((x) => x.id !== t.id))
            }
            className="shrink-0 rounded-full text-stone-400 hover:bg-white/10 hover:text-white dark:hover:bg-white/10"
            aria-label="Dismiss"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        </div>
      ))}
    </div>
  );
}
