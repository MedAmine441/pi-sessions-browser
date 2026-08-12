"use client";

import { Suspense, useSyncExternalStore } from "react";
import Liquid from "@/components/canvasui/Liquid";
import Embers from "@/components/canvasui/Embers";
import Sidebar from "@/components/Sidebar";
import CommandPalette from "@/components/CommandPalette";
import { Toaster } from "@/components/ui/toast";
import { backgroundEffectsEnabled, EFFECTS_CHANGED } from "@/lib/utils";

const subscribeEffects = (callback: () => void) => {
  window.addEventListener(EFFECTS_CHANGED, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(EFFECTS_CHANGED, callback);
    window.removeEventListener("storage", callback);
  };
};

export default function AppLayout({ children }: { children: React.ReactNode }) {
  // The canvases are decoration with a real GPU cost; the toggle unmounts
  // them entirely so their contexts and loops are released, not just paused.
  const effectsOn = useSyncExternalStore(
    subscribeEffects,
    backgroundEffectsEnabled,
    () => true,
  );

  const content = (
    <>
      <div className="absolute inset-0 bg-stone-950/80 pointer-events-none" aria-hidden="true" />
      {effectsOn && <Embers />}
      <div className="relative z-10 w-full h-full flex overflow-hidden">
        <Suspense fallback={null}>
          <Sidebar />
        </Suspense>
        <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {children}
        </main>
      </div>
      <Suspense fallback={null}>
        <CommandPalette />
      </Suspense>
      <Toaster />
    </>
  );

  if (!effectsOn) {
    // Mirrors the DOM Liquid builds (relative shell, absolute z-10 content
    // box) so nothing shifts when the effect layer is gone.
    return (
      <div className="flex-1 flex overflow-hidden" style={{ position: "relative" }}>
        <div
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 10,
            width: "100%",
            height: "100%",
            overflow: "auto",
          }}
        >
          {content}
        </div>
      </div>
    );
  }

  return <Liquid className="flex-1 flex overflow-hidden">{content}</Liquid>;
}
