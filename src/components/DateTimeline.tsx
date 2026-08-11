"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Clock,
  Plus,
  Calendar as CalendarIcon,
  ChevronRight,
  Folder,
  Layers,
} from "lucide-react";
import { formatReadableDate, localDateKey, shortenPath } from "@/lib/utils";
import FolderPicker from "./FolderPicker";
import { usePathname } from "next/navigation";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { Button, buttonVariants } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

type DateItem = {
  date: string;
  count: number;
};

export default function DateTimeline() {
  const [dates, setDates] = useState<DateItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pickingFolder, setPickingFolder] = useState(false);
  const pageSize = 20;
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const location = searchParams.get("location") || "";
  const fromDate = searchParams.get("fromDate") || "";
  // The local day, not toISOString()'s UTC day, which hides today's sessions
  // from local midnight until UTC midnight in any timezone ahead of UTC.
  const toDate = searchParams.get("toDate") || localDateKey(new Date());

  const updateFilters = (updates: { fromDate?: string; toDate?: string }) => {
    const params = new URLSearchParams(searchParams.toString());
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

  useEffect(() => {
    let url = "/api/dates";
    if (location) {
      url += `?location=${encodeURIComponent(location)}`;
    }
    fetch(url)
      .then((r) => r.json())
      .then((d) => {
        // Everything is a canonical YYYY-MM-DD key, so range checks are
        // plain string comparisons — no locale-dependent re-parsing.
        let filtered: DateItem[] = Array.isArray(d) ? d : [];
        if (fromDate) filtered = filtered.filter((item) => item.date >= fromDate);
        if (toDate) filtered = filtered.filter((item) => item.date <= toDate);
        setDates(filtered);
        setLoading(false);
      })
      .catch((e) => {
        console.error(e);
        setLoading(false);
      });
  }, [location, fromDate, toDate]);

  const createSessionIn = async (cwd: string) => {
    setPickingFolder(false);
    try {
      const res = await fetch("/api/new-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd }),
      });
      const data = await res.json();
      if (!res.ok)
        throw new Error(data.error || "Failed to create new session");

      if (data.file) {
        // Today's page opens the session straight into the chat modal, with the
        // sidebar following the folder the session was created in.
        const params = new URLSearchParams(searchParams.toString());
        params.set("location", cwd);
        params.set("session", data.file);
        const today = localDateKey(new Date());
        router.push(`/${encodeURIComponent(today)}?${params.toString()}`);
      }
    } catch (err: any) {
      alert(err.message);
    }
  };

  // With every location shown at once there is no folder to infer, so ask.
  const launchNewSession = () => {
    if (location) createSessionIn(location);
    else setPickingFolder(true);
  };

  const totalPages = Math.ceil(dates.length / pageSize);

  return (
    <div className="w-full h-full flex flex-col pointer-events-auto">
      {/* HUD Header overlay (Search and branding) */}
      <div className="p-6 md:p-8 flex flex-col lg:flex-row justify-between items-start lg:items-center gap-6 shrink-0">
        <div className="flex items-center gap-4 pointer-events-auto pl-10 md:pl-0 min-w-0">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-widest text-stone-500 mb-1">
              {location ? "Folder" : "Showing"}
            </p>
            <h1
              className="text-2xl md:text-3xl font-extrabold tracking-tighter bg-linear-to-br from-white via-amber-200 to-amber-500 bg-clip-text text-transparent flex items-center gap-3 drop-shadow-lg"
              title={location || "Every folder with sessions"}
            >
              {location ? (
                <Folder
                  className="w-6 h-6 shrink-0 text-amber-400"
                  aria-hidden="true"
                />
              ) : (
                <Layers
                  className="w-6 h-6 shrink-0 text-amber-400"
                  aria-hidden="true"
                />
              )}
              <span className="truncate">
                {location ? shortenPath(location) : "All Locations"}
              </span>
            </h1>
          </div>
        </div>

        {/* Date Filters Centered */}
        <search className="flex-1 flex justify-start lg:justify-center w-full lg:w-auto pointer-events-auto">
          <div className="flex items-center gap-3 bg-stone-900/60 backdrop-blur-md border border-white/10 p-2 md:p-3 rounded-2xl w-full max-w-lg md:max-w-none md:w-auto">
            <div className="flex items-center gap-2 px-2 text-stone-400">
              <CalendarIcon
                className="w-4 h-4 hidden md:block"
                aria-hidden="true"
              />
              <span className="text-xs font-bold uppercase tracking-wider hidden md:block">
                Range
              </span>
            </div>

            <div className="flex items-center gap-2 flex-1 md:flex-initial">
              <div className="flex-1 md:w-44">
                <div className="text-[9px] text-stone-500 mb-0.5 ml-1 font-semibold uppercase md:hidden">
                  From
                </div>
                <Popover>
                  <PopoverTrigger
                    aria-label="Filter sessions from date"
                    className={cn(
                      buttonVariants({ variant: "outline" }),
                      "w-full bg-black/40 border border-white/5 justify-start text-left font-normal text-xs md:text-sm text-stone-300 hover:bg-stone-800 dark:hover:bg-stone-800 hover:text-white rounded-xl h-10",
                      !fromDate && "text-muted-foreground",
                    )}
                  >
                    <CalendarIcon
                      className="mr-2 h-4 w-4 shrink-0"
                      aria-hidden="true"
                    />
                    {fromDate ? (
                      format(new Date(fromDate + "T00:00:00"), "PPP")
                    ) : (
                      <span>Forever</span>
                    )}
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={
                        fromDate ? new Date(fromDate + "T00:00:00") : undefined
                      }
                      onSelect={(date: Date | undefined) =>
                        updateFilters({
                          fromDate: date ? format(date, "yyyy-MM-dd") : "",
                        })
                      }
                    />
                  </PopoverContent>
                </Popover>
              </div>

              <ChevronRight
                className="w-4 h-4 text-stone-600 shrink-0"
                aria-hidden="true"
              />

              <div className="flex-1 md:w-44">
                <div className="text-[9px] text-stone-500 mb-0.5 ml-1 font-semibold uppercase md:hidden">
                  To
                </div>
                <Popover>
                  <PopoverTrigger
                    aria-label="Filter sessions to date"
                    className={cn(
                      buttonVariants({ variant: "outline" }),
                      "w-full bg-black/40 border border-white/5 justify-start text-left font-normal text-xs md:text-sm text-stone-300 hover:bg-stone-800 dark:hover:bg-stone-800 hover:text-white rounded-xl h-10",
                      !toDate && "text-muted-foreground",
                    )}
                  >
                    <CalendarIcon
                      className="mr-2 h-4 w-4 shrink-0"
                      aria-hidden="true"
                    />
                    {toDate ? (
                      format(new Date(toDate + "T00:00:00"), "PPP")
                    ) : (
                      <span>Pick a date</span>
                    )}
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={
                        toDate ? new Date(toDate + "T00:00:00") : undefined
                      }
                      onSelect={(date: Date | undefined) =>
                        updateFilters({
                          toDate: date ? format(date, "yyyy-MM-dd") : "",
                        })
                      }
                    />
                  </PopoverContent>
                </Popover>
              </div>
            </div>
          </div>
        </search>

        <div className="flex items-center gap-4 w-full lg:w-auto pointer-events-auto">
          <Button
            onClick={launchNewSession}
            title={
              location
                ? `New session in ${location}`
                : "Pick a folder for the new session"
            }
            className="h-auto w-full lg:w-auto gap-2 px-6 py-3 bg-amber-600 hover:bg-amber-500 text-white rounded-2xl font-bold shadow-[0_0_20px_rgba(217,119,6,0.3)] hover:shadow-[0_0_30px_rgba(217,119,6,0.5)] hover:-translate-y-0.5"
          >
            <Plus className="w-5 h-5" aria-hidden="true" /> New Session
            {location ? "" : "…"}
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto w-full custom-scrollbar pointer-events-auto">
        <div className="max-w-7xl mx-auto p-6 md:p-8">
          <section
            className="animate-in fade-in zoom-in-95 duration-500"
            aria-labelledby="timeline-heading"
          >
            <h2
              id="timeline-heading"
              className="text-lg font-mono text-amber-300/60 mb-6 flex items-center gap-2"
            >
              <Clock className="w-4 h-4" aria-hidden="true" /> Timeline
            </h2>

            {loading ? (
              <p
                className="text-center py-20 text-stone-500 font-mono animate-pulse"
                role="status"
              >
                Loading timeline...
              </p>
            ) : dates.length === 0 ? (
              <div className="text-center py-20">
                <div className="w-24 h-24 bg-stone-900/50 rounded-full flex items-center justify-center mx-auto mb-6">
                  <Clock
                    className="w-10 h-10 text-stone-700"
                    aria-hidden="true"
                  />
                </div>
                <h3 className="text-xl font-bold text-stone-300 mb-2">
                  No dates found
                </h3>
              </div>
            ) : (
              <>
                <ul className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                  {dates
                    .slice((page - 1) * pageSize, page * pageSize)
                    .map((d) => (
                      <li key={d.date}>
                        <Button
                          variant="ghost"
                          onClick={() =>
                            router.push(
                              `/${encodeURIComponent(d.date)}?${searchParams.toString()}`,
                            )
                          }
                          className="group relative h-auto w-full flex-col items-start justify-start gap-2 whitespace-normal text-left bg-stone-900/60 backdrop-blur-2xl border-white/10 hover:bg-amber-900/30 dark:hover:bg-amber-900/30 hover:border-amber-500/50 p-6 rounded-3xl transition-all duration-300 hover:scale-105 shadow-xl hover:shadow-[0_10px_40px_rgba(59,130,246,0.3)]"
                        >
                          <span
                            className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent rounded-3xl opacity-0 group-hover:opacity-100 transition-opacity"
                            aria-hidden="true"
                          />
                          <span className="relative text-xl md:text-2xl font-bold text-white group-hover:text-amber-300 transition-colors">
                            {formatReadableDate(d.date)}
                          </span>
                          <span className="relative text-stone-400 font-mono text-sm group-hover:text-amber-200/70 transition-colors">
                            {d.count} session{d.count !== 1 ? "s" : ""}
                          </span>
                        </Button>
                      </li>
                    ))}
                </ul>
                {totalPages > 1 && (
                  <nav
                    className="mt-12 flex items-center justify-center gap-4 pb-8"
                    aria-label="Timeline pagination"
                  >
                    <Button
                      variant="ghost"
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      disabled={page === 1}
                      className="h-auto px-4 py-2 bg-stone-800 hover:bg-stone-700 dark:hover:bg-stone-700 text-white hover:text-white rounded-xl"
                    >
                      Previous
                    </Button>
                    <span
                      className="text-stone-400 font-mono text-sm"
                      aria-live="polite"
                    >
                      Page {page} of {totalPages}
                    </span>
                    <Button
                      variant="ghost"
                      onClick={() =>
                        setPage((p) => Math.min(totalPages, p + 1))
                      }
                      disabled={page === totalPages}
                      className="h-auto px-4 py-2 bg-stone-800 hover:bg-stone-700 dark:hover:bg-stone-700 text-white hover:text-white rounded-xl"
                    >
                      Next
                    </Button>
                  </nav>
                )}
              </>
            )}
          </section>
        </div>
      </div>

      {pickingFolder && (
        <FolderPicker
          onCancel={() => setPickingFolder(false)}
          onSelect={createSessionIn}
        />
      )}
    </div>
  );
}
