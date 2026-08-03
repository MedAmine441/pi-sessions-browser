"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Clock, Plus } from "lucide-react";
import { formatReadableDate } from "@/lib/utils";

type DateItem = {
  date: string;
  count: number;
};

export default function DateTimeline() {
  const [dates, setDates] = useState<DateItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const router = useRouter();
  const searchParams = useSearchParams();
  const location = searchParams.get("location") || "";
  const fromDate = searchParams.get("fromDate") || "";
  const toDate = searchParams.get("toDate") || "";

  useEffect(() => {
    let url = "/api/dates";
    if (location) {
      url += `?location=${encodeURIComponent(location)}`;
    }
    fetch(url)
      .then(r => r.json())
      .then(d => {
        let filtered = Array.isArray(d) ? d : [];
        if (fromDate) {
          const [y, m, day] = fromDate.split('-');
          const fromTime = new Date(Number(y), Number(m) - 1, Number(day)).getTime();
          filtered = filtered.filter(item => new Date(item.date).getTime() >= fromTime);
        }
        if (toDate) {
          const [y, m, day] = toDate.split('-');
          const toTime = new Date(Number(y), Number(m) - 1, Number(day), 23, 59, 59, 999).getTime();
          filtered = filtered.filter(item => new Date(item.date).getTime() <= toTime);
        }
        setDates(filtered);
        setLoading(false);
      })
      .catch(e => { console.error(e); setLoading(false); });
  }, [location, fromDate, toDate]);

  const launchNewSession = async () => {
    try {
      const res = await fetch("/api/new-session", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create new session");
      
      if (data.file) {
        // Go to today's date page, and wait, how do we open the modal? 
        // We probably need to pass ?session=file parameter!
        const today = new Date().toLocaleDateString();
        router.push(`/${encodeURIComponent(today)}?session=${encodeURIComponent(data.file)}`);
      }
    } catch (err: any) {
      alert(err.message);
    }
  };

  return (
    <div className="w-full h-full flex flex-col pointer-events-auto">
      {/* HUD Header overlay (Search and branding) */}
      <div className="p-6 md:p-8 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 shrink-0">
        <div className="flex items-center gap-4 pointer-events-auto">
          <h1 className="text-3xl font-extrabold tracking-tighter bg-gradient-to-br from-white via-amber-200 to-amber-500 bg-clip-text text-transparent flex items-center gap-3 drop-shadow-lg">
            Pi Session Browser
          </h1>
        </div>
        <div className="flex items-center gap-4 w-full md:w-auto pointer-events-auto">
          <button 
            onClick={launchNewSession}
            className="w-full md:w-auto flex items-center justify-center gap-2 px-6 py-3 bg-amber-600 hover:bg-amber-500 text-white rounded-2xl font-bold transition-all shadow-[0_0_20px_rgba(217,119,6,0.3)] hover:shadow-[0_0_30px_rgba(217,119,6,0.5)] hover:-translate-y-0.5"
          >
            <Plus className="w-5 h-5" /> New Session
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto w-full custom-scrollbar pointer-events-auto">
        <div className="max-w-7xl mx-auto p-6 md:p-8">
          <div className="animate-in fade-in zoom-in-95 duration-500">
            <h2 className="text-lg font-mono text-amber-300/60 mb-6 flex items-center gap-2">
              <Clock className="w-4 h-4" /> Timeline
            </h2>
            
            {loading ? (
              <div className="text-center py-20 text-stone-500 font-mono animate-pulse">Loading timeline...</div>
            ) : dates.length === 0 ? (
              <div className="text-center py-20">
                <div className="w-24 h-24 bg-stone-900/50 rounded-full flex items-center justify-center mx-auto mb-6">
                  <Clock className="w-10 h-10 text-stone-700" />
                </div>
                <h3 className="text-xl font-bold text-stone-300 mb-2">No dates found</h3>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                  {dates.slice((page - 1) * pageSize, page * pageSize).map((d) => (
                    <div
                      key={d.date}
                      role="button"
                      tabIndex={0}
                      onClick={() => router.push(`/${encodeURIComponent(d.date)}?${searchParams.toString()}`)}
                      className="group relative bg-stone-900/60 backdrop-blur-2xl border border-white/10 hover:bg-amber-900/30 hover:border-amber-500/50 p-6 rounded-3xl cursor-pointer transition-all duration-300 hover:scale-105 shadow-xl hover:shadow-[0_10px_40px_rgba(59,130,246,0.3)]"
                    >
                      <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent rounded-3xl opacity-0 group-hover:opacity-100 transition-opacity" />
                      <div className="text-xl md:text-2xl font-bold text-white mb-2 group-hover:text-amber-300 transition-colors">
                        {formatReadableDate(d.date)}
                      </div>
                      <div className="text-stone-400 font-mono text-sm group-hover:text-amber-200/70 transition-colors">
                        {d.count} session{d.count !== 1 ? 's' : ''}
                      </div>
                    </div>
                  ))}
                </div>
                {Math.ceil(dates.length / pageSize) > 1 && (
                  <div className="mt-12 flex items-center justify-center gap-4 pb-8">
                    <button 
                      onClick={() => setPage(p => Math.max(1, p - 1))}
                      disabled={page === 1}
                      className="px-4 py-2 bg-stone-800 hover:bg-stone-700 disabled:opacity-50 disabled:hover:bg-stone-800 text-white rounded-xl transition-all"
                    >
                      Previous
                    </button>
                    <span className="text-stone-400 font-mono text-sm">
                      Page {page} of {Math.ceil(dates.length / pageSize)}
                    </span>
                    <button 
                      onClick={() => setPage(p => Math.min(Math.ceil(dates.length / pageSize), p + 1))}
                      disabled={page === Math.ceil(dates.length / pageSize)}
                      className="px-4 py-2 bg-stone-800 hover:bg-stone-700 disabled:opacity-50 disabled:hover:bg-stone-800 text-white rounded-xl transition-all"
                    >
                      Next
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
