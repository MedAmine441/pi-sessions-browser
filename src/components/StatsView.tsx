"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { subDays } from "date-fns";
import {
  ArrowLeft,
  BarChart3,
  Folder,
  Layers,
  Cpu,
  RefreshCw,
} from "lucide-react";
import type { SessionStats, StatsBucket } from "@/types";
import {
  fetchJson,
  formatCost,
  formatReadableDate,
  formatTokens,
  localDateKey,
  shortenPath,
} from "@/lib/utils";
import { Button } from "@/components/ui/button";

const DAYS_SHOWN = 30;

function StatTile({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="rounded-3xl border border-white/5 bg-stone-900/40 p-5 backdrop-blur-xl">
      <p className="text-[10px] font-bold uppercase tracking-widest text-stone-500">{label}</p>
      <p className="mt-1 text-3xl font-extrabold text-white">{value}</p>
      {detail && <p className="mt-1 font-mono text-[11px] text-stone-500">{detail}</p>}
    </div>
  );
}

/** One row of the model/folder breakdowns: label, thin bar, numbers. */
function BarRow({
  label,
  title,
  bucket,
  max,
  showCost,
}: {
  label: string;
  title?: string;
  bucket: StatsBucket;
  max: number;
  showCost: boolean;
}) {
  const metric = showCost ? bucket.cost : bucket.sessions;
  const percent = max > 0 ? Math.max((metric / max) * 100, metric > 0 ? 1.5 : 0) : 0;
  return (
    <li className="py-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 flex-1 truncate text-sm text-stone-200" title={title || label}>
          {label}
        </span>
        <span className="shrink-0 font-mono text-[11px] text-stone-500">
          {showCost && bucket.cost > 0 ? `${formatCost(bucket.cost)} · ` : ""}
          {bucket.sessions} session{bucket.sessions === 1 ? "" : "s"} ·{" "}
          {formatTokens(bucket.inputTokens + bucket.outputTokens)} tok
        </span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/5" aria-hidden="true">
        <div
          className="h-full rounded-full bg-amber-500/80"
          style={{ width: `${percent}%` }}
        />
      </div>
    </li>
  );
}

export default function StatsView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const location = searchParams.get("location") || "";

  const [stats, setStats] = useState<SessionStats | null>(null);
  const [failed, setFailed] = useState(false);
  const [fetchCount, setFetchCount] = useState(0);

  // A different folder is a different dataset — blank the page during render
  // rather than from inside the effect.
  const [prevLocation, setPrevLocation] = useState(location);
  if (prevLocation !== location) {
    setPrevLocation(location);
    setStats(null);
    setFailed(false);
  }

  const refresh = () => {
    setStats(null);
    setFailed(false);
    setFetchCount((n) => n + 1);
  };

  useEffect(() => {
    const controller = new AbortController();
    const url = location
      ? `/api/stats?location=${encodeURIComponent(location)}`
      : "/api/stats";
    fetchJson<SessionStats>(url, { signal: controller.signal })
      .then(setStats)
      .catch((err) => {
        if (controller.signal.aborted) return;
        console.error(err);
        setFailed(true);
      });
    return () => controller.abort();
  }, [location, fetchCount]);

  // With no dollar figures on record (all-local or unpriced models), the
  // charts fall back to counting sessions instead of graphing zeros.
  const showCost = (stats?.totals.cost ?? 0) > 0;

  /** The last 30 calendar days, empty ones included — honest time spacing. */
  const days = useMemo(() => {
    if (!stats) return [];
    const byDay = new Map(stats.perDay.map((bucket) => [bucket.key, bucket]));
    const today = new Date();
    return Array.from({ length: DAYS_SHOWN }, (_, i) => {
      const key = localDateKey(subDays(today, DAYS_SHOWN - 1 - i));
      return (
        byDay.get(key) ?? {
          key,
          sessions: 0,
          messages: 0,
          cost: 0,
          inputTokens: 0,
          outputTokens: 0,
        }
      );
    });
  }, [stats]);

  const dayMax = useMemo(
    () =>
      days.reduce(
        (max, bucket) => Math.max(max, showCost ? bucket.cost : bucket.sessions),
        0,
      ),
    [days, showCost],
  );

  const barMax = (buckets: StatsBucket[]) =>
    buckets.reduce(
      (max, bucket) => Math.max(max, showCost ? bucket.cost : bucket.sessions),
      0,
    );

  const topFolders = stats?.perFolder.slice(0, 10) ?? [];
  const moreFolders = (stats?.perFolder.length ?? 0) - topFolders.length;

  return (
    <div className="pointer-events-auto flex h-full w-full flex-col">
      <div className="flex shrink-0 flex-col items-start justify-between gap-4 p-6 pl-14 md:flex-row md:items-center md:p-8 md:pl-8">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            onClick={() => router.push(`/?${searchParams.toString()}`)}
            className="group h-auto gap-2 rounded-xl border-white/10 bg-stone-900/60 px-4 py-2 text-stone-300 backdrop-blur-md hover:bg-stone-800/80 hover:text-white dark:hover:bg-stone-800/80"
          >
            <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-1" aria-hidden="true" />
            Back
          </Button>
          <h1 className="flex items-center gap-3 text-3xl font-extrabold text-white drop-shadow-lg">
            <BarChart3 className="h-7 w-7 text-amber-400" aria-hidden="true" />
            Stats
          </h1>
        </div>
        <div className="flex items-center gap-3 font-mono text-xs text-stone-400">
          {location ? (
            <>
              <span className="flex items-center gap-1.5 truncate" title={location}>
                <Folder className="h-3.5 w-3.5 text-amber-400" aria-hidden="true" />
                {shortenPath(location)}
              </span>
              <Button
                variant="ghost"
                onClick={() => router.replace("/stats")}
                className="h-auto rounded-lg bg-white/5 px-2 py-1 text-[11px] text-stone-400 hover:bg-white/10 hover:text-white dark:hover:bg-white/10"
              >
                <Layers className="h-3 w-3" aria-hidden="true" /> All locations
              </Button>
            </>
          ) : (
            <span className="flex items-center gap-1.5">
              <Layers className="h-3.5 w-3.5 text-amber-400" aria-hidden="true" />
              All locations
            </span>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={refresh}
            className="group size-9 rounded-xl border-white/10 bg-stone-900/60 text-stone-300 backdrop-blur-md hover:bg-stone-800 hover:text-white dark:hover:bg-stone-800"
            title="Refresh"
            aria-label="Refresh stats"
          >
            <RefreshCw
              className={`h-4 w-4 ${stats === null && !failed ? "animate-spin" : "transition-transform duration-500 group-hover:rotate-180"}`}
              aria-hidden="true"
            />
          </Button>
        </div>
      </div>

      <div className="custom-scrollbar w-full flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl p-6 md:p-8">
          {failed ? (
            <p className="py-20 text-center font-mono text-sm text-red-400" role="status">
              Could not load stats.
            </p>
          ) : stats === null ? (
            <p className="animate-pulse py-20 text-center font-mono text-stone-500" role="status">
              Crunching sessions...
            </p>
          ) : stats.totals.sessions === 0 ? (
            <p className="py-20 text-center text-stone-400" role="status">
              No sessions recorded yet.
            </p>
          ) : (
            <div className="space-y-6">
              {/* KPI row */}
              <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                <StatTile
                  label="Total spend"
                  value={stats.totals.cost > 0 ? formatCost(stats.totals.cost) : "$0"}
                  detail="recorded usage cost"
                />
                <StatTile
                  label="Sessions"
                  value={stats.totals.sessions.toLocaleString()}
                  detail={`${stats.totals.messages.toLocaleString()} messages`}
                />
                <StatTile
                  label="Input tokens"
                  value={formatTokens(stats.totals.inputTokens)}
                  detail="excludes cache reads"
                />
                <StatTile
                  label="Output tokens"
                  value={formatTokens(stats.totals.outputTokens)}
                />
              </div>

              {/* Daily chart */}
              <section
                aria-label={`${showCost ? "Spend" : "Sessions"} per day, last ${DAYS_SHOWN} days`}
                className="rounded-3xl border border-white/5 bg-stone-900/40 p-5 backdrop-blur-xl"
              >
                <div className="mb-4 flex items-baseline justify-between">
                  <h2 className="text-sm font-bold text-stone-200">
                    {showCost ? "Spend per day" : "Sessions per day"}
                  </h2>
                  <span className="font-mono text-[10px] text-stone-500">
                    last {DAYS_SHOWN} days · peak{" "}
                    {showCost ? formatCost(dayMax) : dayMax.toLocaleString()}
                  </span>
                </div>
                <div className="flex h-40 items-end gap-0.5">
                  {days.map((bucket) => {
                    const metric = showCost ? bucket.cost : bucket.sessions;
                    const percent =
                      dayMax > 0 ? Math.max((metric / dayMax) * 100, metric > 0 ? 2 : 0) : 0;
                    const label = `${formatReadableDate(bucket.key)}: ${
                      showCost ? formatCost(bucket.cost) : ""
                    }${showCost && bucket.cost > 0 ? ", " : ""}${bucket.sessions} session${
                      bucket.sessions === 1 ? "" : "s"
                    }, ${formatTokens(bucket.inputTokens + bucket.outputTokens)} tokens`;
                    return (
                      <div
                        key={bucket.key}
                        className="group relative flex h-full flex-1 items-end"
                        tabIndex={0}
                        role="img"
                        aria-label={label}
                      >
                        <div
                          className={`w-full rounded-t ${
                            metric > 0 ? "bg-amber-500/80 group-hover:bg-amber-400" : "bg-white/5"
                          }`}
                          style={{ height: `${Math.max(percent, 1)}%` }}
                        />
                        <div
                          className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 hidden -translate-x-1/2 whitespace-nowrap rounded-lg border border-white/10 bg-stone-950/95 px-2.5 py-1.5 font-mono text-[10px] text-stone-300 shadow-xl group-hover:block group-focus-visible:block"
                          aria-hidden="true"
                        >
                          {label}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="mt-2 flex justify-between border-t border-white/10 pt-1.5 font-mono text-[10px] text-stone-600">
                  <span>{formatReadableDate(days[0]?.key ?? "")}</span>
                  <span>{formatReadableDate(days.at(-1)?.key ?? "")}</span>
                </div>
              </section>

              {/* Breakdowns */}
              <div className="grid gap-6 lg:grid-cols-2">
                <section
                  aria-label="Usage by model"
                  className="rounded-3xl border border-white/5 bg-stone-900/40 p-5 backdrop-blur-xl"
                >
                  <h2 className="mb-2 flex items-center gap-2 text-sm font-bold text-stone-200">
                    <Cpu className="h-4 w-4 text-amber-400" aria-hidden="true" /> By model
                  </h2>
                  <ul className="divide-y divide-white/5">
                    {stats.perModel.map((bucket) => (
                      <BarRow
                        key={bucket.key}
                        label={bucket.key}
                        bucket={bucket}
                        max={barMax(stats.perModel)}
                        showCost={showCost}
                      />
                    ))}
                  </ul>
                </section>
                <section
                  aria-label="Usage by folder"
                  className="rounded-3xl border border-white/5 bg-stone-900/40 p-5 backdrop-blur-xl"
                >
                  <h2 className="mb-2 flex items-center gap-2 text-sm font-bold text-stone-200">
                    <Folder className="h-4 w-4 text-amber-400" aria-hidden="true" /> By folder
                  </h2>
                  <ul className="divide-y divide-white/5">
                    {topFolders.map((bucket) => (
                      <BarRow
                        key={bucket.key}
                        label={shortenPath(bucket.key)}
                        title={bucket.key}
                        bucket={bucket}
                        max={barMax(topFolders)}
                        showCost={showCost}
                      />
                    ))}
                  </ul>
                  {moreFolders > 0 && (
                    <p className="mt-2 font-mono text-[10px] text-stone-600">
                      …and {moreFolders} more folder{moreFolders === 1 ? "" : "s"}
                    </p>
                  )}
                </section>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
