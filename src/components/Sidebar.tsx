"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { FolderGit2, Calendar, ChevronRight } from "lucide-react";

export default function Sidebar() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  
  const [locations, setLocations] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  
  const currentLocation = searchParams.get("location") || "";
  const fromDate = searchParams.get("fromDate") || "";
  const toDate = searchParams.get("toDate") || new Date().toISOString().split("T")[0];

  useEffect(() => {
    fetch("/api/locations")
      .then(r => r.json())
      .then(data => {
        setLocations(data.locations || []);
        if (!currentLocation && data.defaultLocation) {
          updateFilters({ location: data.defaultLocation });
        }
        setLoading(false);
      })
      .catch(err => {
        console.error(err);
        setLoading(false);
      });
  }, []);

  const updateFilters = (updates: { location?: string, fromDate?: string, toDate?: string }) => {
    const params = new URLSearchParams(searchParams.toString());
    
    if (updates.location !== undefined) {
      if (updates.location) params.set("location", updates.location);
      else params.delete("location");
    }
    
    if (updates.fromDate !== undefined) {
      if (updates.fromDate) params.set("fromDate", updates.fromDate);
      else params.delete("fromDate");
    }
    
    if (updates.toDate !== undefined) {
      if (updates.toDate) params.set("toDate", updates.toDate);
      else params.delete("toDate");
    }
    
    router.replace(`${pathname}?${params.toString()}`);
  };

  const decodeLocation = (loc: string) => {
    return loc.replace(/^--/, "").replace(/--$/, "").replace(/-/g, "/");
  };

  return (
    <div className="w-64 border-r border-white/10 bg-stone-950/50 backdrop-blur-md h-full flex flex-col pointer-events-auto p-4 shrink-0">
      <div className="mb-8 mt-4 px-2">
        <h2 className="text-xl font-black text-amber-500 tracking-tight flex items-center gap-2">
          Filters
        </h2>
      </div>

      <div className="space-y-6 flex-1 overflow-y-auto custom-scrollbar pr-2">
        {/* Location Filter */}
        <div className="space-y-3">
          <label className="text-xs font-bold text-stone-400 uppercase tracking-wider flex items-center gap-2">
            <FolderGit2 className="w-4 h-4" /> Location
          </label>
          <div className="space-y-1">
            {loading ? (
              <div className="text-sm text-stone-500 animate-pulse px-2">Loading...</div>
            ) : locations.length === 0 ? (
              <div className="text-sm text-stone-500 px-2">No locations found</div>
            ) : (
              <select 
                value={currentLocation}
                onChange={(e) => updateFilters({ location: e.target.value })}
                className="w-full bg-stone-900 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-stone-300 focus:outline-none focus:border-amber-500/50 transition-colors cursor-pointer"
              >
                <option value="">All Locations</option>
                {locations.map(loc => (
                  <option key={loc} value={loc}>
                    {decodeLocation(loc)}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>

        {/* Date Filters */}
        <div className="space-y-3 pt-4 border-t border-white/5">
          <label className="text-xs font-bold text-stone-400 uppercase tracking-wider flex items-center gap-2">
            <Calendar className="w-4 h-4" /> Date Range
          </label>
          
          <div className="space-y-3">
            <div>
              <div className="text-[10px] text-stone-500 mb-1 ml-1 font-semibold uppercase">From</div>
              <input 
                type="date"
                value={fromDate}
                onChange={(e) => updateFilters({ fromDate: e.target.value })}
                className="w-full bg-stone-900 border border-white/10 rounded-xl px-3 py-2 text-sm text-stone-300 focus:outline-none focus:border-amber-500/50 transition-colors"
                placeholder="Forever"
              />
            </div>
            
            <div className="flex justify-center">
              <ChevronRight className="w-4 h-4 text-stone-600 rotate-90" />
            </div>

            <div>
              <div className="text-[10px] text-stone-500 mb-1 ml-1 font-semibold uppercase">To</div>
              <input 
                type="date"
                value={toDate}
                onChange={(e) => updateFilters({ toDate: e.target.value })}
                className="w-full bg-stone-900 border border-white/10 rounded-xl px-3 py-2 text-sm text-stone-300 focus:outline-none focus:border-amber-500/50 transition-colors"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
