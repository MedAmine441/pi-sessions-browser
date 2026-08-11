"use client";

import { Suspense } from "react";
import Liquid from "@/components/canvasui/Liquid";
import Embers from "@/components/canvasui/Embers";
import Sidebar from "@/components/Sidebar";
import CommandPalette from "@/components/CommandPalette";
import { Toaster } from "@/components/ui/toast";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <Liquid className="flex-1 flex overflow-hidden">
      <div className="absolute inset-0 bg-stone-950/80 pointer-events-none" aria-hidden="true" />
      <Embers />
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
    </Liquid>
  );
}
