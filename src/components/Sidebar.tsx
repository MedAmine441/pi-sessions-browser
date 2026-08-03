"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { FolderGit2, Menu, X } from "lucide-react";

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

  const decodeLocation = (loc: string) => {
    return loc.replace(/^--/, "").replace(/--$/, "").replace(/-/g, "/");
  };

  return (
    <>
      {/* Mobile Burger Button */}
      <button 
        onClick={() => setIsOpen(true)}
        className="md:hidden fixed top-6 left-4 z-40 p-2 bg-stone-900/80 backdrop-blur-md border border-white/10 rounded-xl text-stone-300 hover:text-white"
      >
        <Menu className="w-5 h-5" />
      </button>

      {/* Mobile Overlay */}
      {isOpen && (
        <div 
          className="md:hidden fixed inset-0 bg-black/60 backdrop-blur-sm z-40"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* Sidebar Container */}
      <div className={`
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
          <button 
            className="md:hidden p-1 text-stone-400 hover:text-white"
            onClick={() => setIsOpen(false)}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar pr-2 space-y-1">
          {loading ? (
            <div className="text-sm text-stone-500 animate-pulse px-2">Loading locations...</div>
          ) : locations.length === 0 ? (
            <div className="text-sm text-stone-500 px-2">No locations found</div>
          ) : (
            <>
              <button
                onClick={() => { updateLocation(""); setIsOpen(false); }}
                className={`w-full text-left px-3 py-3 rounded-xl transition-all flex items-center gap-3 ${
                  currentLocation === "" 
                    ? "bg-amber-500/20 text-amber-400 border border-amber-500/30 font-bold shadow-[0_0_15px_rgba(217,119,6,0.1)]" 
                    : "text-stone-400 hover:bg-stone-900 border border-transparent hover:text-stone-200"
                }`}
              >
                <FolderGit2 className="w-4 h-4 shrink-0" />
                <span className="truncate text-sm">All Locations</span>
              </button>
              
              {locations.map(loc => (
                <button
                  key={loc}
                  onClick={() => { updateLocation(loc); setIsOpen(false); }}
                  className={`w-full text-left px-3 py-3 rounded-xl transition-all flex items-center gap-3 ${
                    currentLocation === loc
                      ? "bg-amber-500/20 text-amber-400 border border-amber-500/30 font-bold shadow-[0_0_15px_rgba(217,119,6,0.1)]" 
                      : "text-stone-400 hover:bg-stone-900 border border-transparent hover:text-stone-200"
                  }`}
                  title={decodeLocation(loc)}
                >
                  <FolderGit2 className="w-4 h-4 shrink-0" />
                  <span className="truncate text-sm">{decodeLocation(loc)}</span>
                </button>
              ))}
            </>
          )}
        </div>
      </div>
    </>
  );
}
