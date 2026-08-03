"use client";

import { Suspense } from "react";
import Liquid from "@/components/canvasui/Liquid";
import Embers from "@/components/canvasui/Embers";
import Sidebar from "@/components/Sidebar";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <Liquid className="flex-1 flex overflow-hidden">
      <div className="absolute inset-0 bg-stone-950/80 pointer-events-none" />
      <Embers />
      <div className="relative z-10 w-full h-full flex overflow-hidden">
        <Suspense fallback={null}>
          <Sidebar />
        </Suspense>
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {children}
        </div>
      </div>
    </Liquid>
  );
}
