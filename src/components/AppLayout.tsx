"use client";

import Liquid from "@/components/canvasui/Liquid";
import Embers from "@/components/canvasui/Embers";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <Liquid className="flex-1">
      <div className="absolute inset-0 bg-stone-950/80 pointer-events-none" />
      <Embers />
      <div className="relative z-10 w-full h-full flex flex-col">
        {children}
      </div>
    </Liquid>
  );
}
