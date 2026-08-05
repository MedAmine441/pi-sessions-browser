"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { FolderGit2, Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { shortenPath } from "@/lib/utils";

export default function Sidebar() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();

  const [locations, setLocations] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [isOpen, setIsOpen] = useState(false);

  const currentLocation = searchParams.get("location") || "";

  useEffect(() => {
    fetch("/api/locations")
      .then(r => r.json())
      .then(data => {
        setLocations(data.locations || []);
        if (!currentLocation && data.defaultLocation) {
          updateLocation(data.defaultLocation);
        }
        setLoading(false);
      })
      .catch(err => {
        console.error(err);
        setLoading(false);
      });
  }, []);

  const updateLocation = (location: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (location) params.set("location", location);
    else params.delete("location");
    router.replace(`${pathname}?${params.toString()}`);
  };

  const itemClasses = (isActive: boolean) =>
    `h-auto w-full justify-start gap-3 rounded-xl border px-3 py-3 text-left transition-all ${
      isActive
        ? "bg-amber-500/20 text-amber-400 border-amber-500/30 font-bold shadow-[0_0_15px_rgba(217,119,6,0.1)] hover:bg-amber-500/30 dark:hover:bg-amber-500/30 hover:text-amber-300"
        : "text-stone-400 border-transparent hover:bg-stone-900 dark:hover:bg-stone-900 hover:text-stone-200"
    }`;

  return (
    <>
      {/* Mobile Burger Button */}
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setIsOpen(true)}
        aria-label="Open locations menu"
        aria-expanded={isOpen}
        aria-controls="locations-sidebar"
        className="md:hidden fixed top-6 left-4 z-40 size-9 bg-stone-900/80 backdrop-blur-md border border-white/10 rounded-xl text-stone-300 hover:bg-stone-800 dark:hover:bg-stone-800 hover:text-white"
      >
        <Menu className="w-5 h-5" />
      </Button>

      {/* Mobile Overlay */}
      {isOpen && (
        <div
          className="md:hidden fixed inset-0 bg-black/60 backdrop-blur-sm z-40"
          onClick={() => setIsOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar Container */}
      <nav
        id="locations-sidebar"
        aria-label="Session locations"
        className={`
        fixed md:relative top-0 left-0 h-full z-50
        w-72 border-r border-white/10 bg-stone-950/90 backdrop-blur-xl flex flex-col pointer-events-auto p-4 shrink-0
        transition-transform duration-300 ease-in-out
        ${isOpen ? 'translate-x-0' : '-translate-x-full'}
        md:translate-x-0
      `}>
        <div className="mb-6 mt-2 px-2 flex items-center justify-between">
          <h2 className="text-xl font-black text-amber-500 tracking-tight flex items-center gap-2">
            Locations
          </h2>
          <Button
            variant="ghost"
            size="icon-sm"
            className="md:hidden text-stone-400 hover:bg-white/10 dark:hover:bg-white/10 hover:text-white"
            onClick={() => setIsOpen(false)}
            aria-label="Close locations menu"
          >
            <X className="w-5 h-5" />
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar pr-2">
          {loading ? (
            <p className="text-sm text-stone-500 animate-pulse px-2">Loading locations...</p>
          ) : locations.length === 0 ? (
            <p className="text-sm text-stone-500 px-2">No locations found</p>
          ) : (
            <ul className="space-y-1">
              <li>
                <Button
                  variant="ghost"
                  onClick={() => { updateLocation(""); setIsOpen(false); }}
                  aria-current={currentLocation === "" ? "true" : undefined}
                  className={itemClasses(currentLocation === "")}
                >
                  <FolderGit2 className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span className="truncate text-sm">All Locations</span>
                </Button>
              </li>

              {locations.map(loc => (
                <li key={loc}>
                  <Button
                    variant="ghost"
                    onClick={() => { updateLocation(loc); setIsOpen(false); }}
                    aria-current={currentLocation === loc ? "true" : undefined}
                    className={itemClasses(currentLocation === loc)}
                    title={loc}
                  >
                    <FolderGit2 className="w-4 h-4 shrink-0" aria-hidden="true" />
                    <span className="truncate text-sm">{shortenPath(loc)}</span>
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </nav>
    </>
  );
}
