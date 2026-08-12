"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Folder,
  Trash2,
  ArrowLeft,
  RefreshCw,
  Terminal,
  ListFilter,
  Pin,
} from "lucide-react";
import { SessionInfo } from "@/types";
import {
  announceLocationsChanged,
  announcePinsChanged,
  fetchJson,
  formatBytes,
  formatCost,
  formatReadableDate,
  messageOf,
  PINS_CHANGED,
  shortenPath,
} from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import ChatModal from "./ChatModal";
import { toast } from "@/components/ui/toast";

const titleOf = (session: SessionInfo) =>
  session.name || session.preview || "Untitled Session";

const modelKeyOf = (session: SessionInfo) =>
  session.model ? `${session.model.provider}/${session.model.modelId}` : "";

type SortKey = "updated" | "cost" | "size" | "messages";

const SORT_LABELS: Record<SortKey, string> = {
  updated: "Last updated",
  cost: "Cost",
  size: "Size",
  messages: "Messages",
};

const selectClass =
  "h-9 rounded-xl border border-white/10 bg-stone-900/80 px-2 text-xs text-stone-300 focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/50 focus:outline-none";

export default function SessionsGrid({ date }: { date: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  // null is "still loading"; refreshes that keep the old grid leave it in place.
  const [sessions, setSessions] = useState<SessionInfo[] | null>(null);
  const [fetchCount, setFetchCount] = useState(0);
  const [pendingDelete, setPendingDelete] = useState<SessionInfo | null>(null);

  // Read open session from query param ?session=file
  const openSessionFile = searchParams.get("session");
  const location = searchParams.get("location") || "";
  const loading = sessions === null;

  const [sortBy, setSortBy] = useState<SortKey>("updated");
  const [modelFilter, setModelFilter] = useState("");
  const [errorsOnly, setErrorsOnly] = useState(false);

  const modelOptions = useMemo(() => {
    const keys = new Set<string>();
    for (const s of sessions || []) {
      const key = modelKeyOf(s);
      if (key) keys.add(key);
    }
    return [...keys].sort();
  }, [sessions]);

  const [pinnedFiles, setPinnedFiles] = useState<Set<string>>(new Set());

  useEffect(() => {
    const loadPins = () =>
      fetchJson<{ pinned: string[] }>("/api/pins")
        .then((data) => setPinnedFiles(new Set(data.pinned || [])))
        .catch(() => {});
    loadPins();
    window.addEventListener(PINS_CHANGED, loadPins);
    return () => window.removeEventListener(PINS_CHANGED, loadPins);
  }, []);

  const togglePin = async (e: React.MouseEvent, session: SessionInfo) => {
    e.preventDefault();
    e.stopPropagation();
    const pinned = !pinnedFiles.has(session.file);
    try {
      const data = await fetchJson<{ pinned: string[] }>("/api/pins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file: session.file, pinned }),
      });
      setPinnedFiles(new Set(data.pinned || []));
      announcePinsChanged();
    } catch (err) {
      toast(messageOf(err));
    }
  };

  const visibleSessions = useMemo(() => {
    let list = sessions || [];
    if (modelFilter) list = list.filter((s) => modelKeyOf(s) === modelFilter);
    if (errorsOnly) list = list.filter((s) => s.hasError);
    let sorted = list;
    if (sortBy !== "updated") {
      sorted = [...list];
      if (sortBy === "cost") sorted.sort((a, b) => b.cost - a.cost);
      else if (sortBy === "size") sorted.sort((a, b) => b.size - a.size);
      else sorted.sort((a, b) => b.messageCount - a.messageCount);
    }
    // Pinned cards float above the rest whatever the sort says.
    return [
      ...sorted.filter((s) => pinnedFiles.has(s.file)),
      ...sorted.filter((s) => !pinnedFiles.has(s.file)),
    ];
  }, [sessions, modelFilter, errorsOnly, sortBy, pinnedFiles]);

  const isFiltered = Boolean(modelFilter || errorsOnly);

  // A different date or folder is a different dataset — blank the grid.
  const dataKey = `${date} ${location}`;
  const [prevDataKey, setPrevDataKey] = useState(dataKey);
  if (prevDataKey !== dataKey) {
    setPrevDataKey(dataKey);
    setSessions(null);
  }

  /** Refetch behind the current grid — no loading flash. */
  const refreshSessions = () => setFetchCount((n) => n + 1);
  /** Refetch showing the loading state, for the explicit Refresh button. */
  const reloadSessions = () => {
    setSessions(null);
    setFetchCount((n) => n + 1);
  };

  useEffect(() => {
    // Abort superseded fetches so a slow response can't overwrite a newer one.
    const controller = new AbortController();
    let url = `/api/sessions?date=${encodeURIComponent(date)}`;
    if (location) {
      url += `&location=${encodeURIComponent(location)}`;
    }
    fetchJson<SessionInfo[]>(url, { signal: controller.signal })
      .then((data) => setSessions(Array.isArray(data) ? data : []))
      .catch((err) => {
        if (controller.signal.aborted) return;
        console.error(err);
        setSessions((prev) => prev ?? []);
      });
    return () => controller.abort();
  }, [date, location, fetchCount]);

  const handleDeleteClick = (e: React.MouseEvent, session: SessionInfo) => {
    e.preventDefault();
    e.stopPropagation();
    setPendingDelete(session);
  };

  const deleteSession = async () => {
    const session = pendingDelete;
    if (!session) return;
    setPendingDelete(null);
    setSessions((prev) => prev && prev.filter((s) => s.file !== session.file));

    try {
      await fetchJson(`/api/sessions?file=${encodeURIComponent(session.file)}`, {
        method: "DELETE",
      });
      announceLocationsChanged();
    } catch (err) {
      // The refresh below restores the card the optimistic filter removed.
      console.error(err);
      toast(`Could not delete the session: ${messageOf(err)}`);
    } finally {
      refreshSessions();
    }
  };

  const handleResumeClick = async (e: React.MouseEvent, file: string) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      await fetchJson("/api/resume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file }),
      });
    } catch (err) {
      toast(messageOf(err));
    }
  };

  // Arrow keys and j/k rove focus across the card buttons; Enter then opens
  // the focused card natively. Typing surfaces (inputs, dialogs) are exempt.
  useEffect(() => {
    if (openSessionFile || pendingDelete) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const forward = ["ArrowRight", "ArrowDown", "j"].includes(e.key);
      if (!forward && !["ArrowLeft", "ArrowUp", "k"].includes(e.key)) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable=true], [role=dialog]"))
        return;
      const cards = [
        ...document.querySelectorAll<HTMLButtonElement>("[data-session-card]"),
      ];
      if (!cards.length) return;
      const at = cards.indexOf(document.activeElement as HTMLButtonElement);
      const next =
        at === -1
          ? forward
            ? 0
            : cards.length - 1
          : Math.min(Math.max(at + (forward ? 1 : -1), 0), cards.length - 1);
      e.preventDefault();
      cards[next]?.focus();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [openSessionFile, pendingDelete]);

  const handleSessionClick = (file: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("session", file);
    router.replace(`/${encodeURIComponent(date)}?${params.toString()}`);
  };

  const closeSession = async (discardIfEmpty = true) => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("session");
    router.replace(`/${encodeURIComponent(date)}?${params.toString()}`);

    // A session closed without a single message never became anything.
    if (discardIfEmpty && openSessionFile) {
      await fetch("/api/sessions/discard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file: openSessionFile }),
      }).catch((err) => console.error(err));
    }
    announceLocationsChanged();
    // Refresh previews/counts behind the grid — no flash on close.
    refreshSessions();
  };

  return (
    <div className="w-full h-full flex flex-col pointer-events-auto">
      {/* HUD Header overlay */}
      <div className="p-6 md:p-8 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 shrink-0 pl-14 md:pl-8">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            onClick={() => router.push(`/?${searchParams.toString()}`)}
            className="group h-auto gap-2 px-4 py-2 bg-stone-900/60 hover:bg-stone-800/80 dark:hover:bg-stone-800/80 border-white/10 rounded-xl text-stone-300 hover:text-white backdrop-blur-md"
          >
            <ArrowLeft
              className="w-4 h-4 group-hover:-translate-x-1 transition-transform"
              aria-hidden="true"
            />
            Back
          </Button>
          <h1 className="text-3xl font-extrabold text-white flex items-center gap-3 drop-shadow-lg">
            {formatReadableDate(date)}
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
          {(sessions?.length ?? 0) > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-white/10 bg-stone-900/60 p-2 backdrop-blur-md">
              <ListFilter className="ml-1 h-4 w-4 text-stone-500" aria-hidden="true" />
              <label className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-stone-500">
                Sort
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as SortKey)}
                  aria-label="Sort sessions"
                  className={selectClass}
                >
                  {(Object.keys(SORT_LABELS) as SortKey[]).map((key) => (
                    <option key={key} value={key}>
                      {SORT_LABELS[key]}
                    </option>
                  ))}
                </select>
              </label>
              {modelOptions.length > 0 && (
                <label className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-stone-500">
                  Model
                  <select
                    value={modelFilter}
                    onChange={(e) => setModelFilter(e.target.value)}
                    aria-label="Filter by model"
                    className={`${selectClass} max-w-44 truncate`}
                  >
                    <option value="">All models</option>
                    {modelOptions.map((key) => (
                      <option key={key} value={key}>
                        {key}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label className="flex cursor-pointer items-center gap-1.5 px-1 text-[10px] font-bold uppercase tracking-widest text-stone-500 hover:text-stone-300">
                <input
                  type="checkbox"
                  checked={errorsOnly}
                  onChange={(e) => setErrorsOnly(e.target.checked)}
                  className="h-3.5 w-3.5 cursor-pointer accent-amber-500"
                />
                Errors
              </label>
            </div>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={reloadSessions}
            className="group size-11 bg-stone-900/60 hover:bg-stone-800 dark:hover:bg-stone-800 border-white/10 rounded-xl text-stone-300 hover:text-white backdrop-blur-md"
            title="Refresh"
            aria-label="Refresh sessions"
          >
            <RefreshCw
              className={`w-5 h-5 ${loading ? "animate-spin" : "group-hover:rotate-180 transition-transform duration-500"}`}
              aria-hidden="true"
            />
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto w-full custom-scrollbar">
        <div className="max-w-7xl mx-auto p-6 md:p-8">
          {sessions === null ? (
            <p
              className="text-center py-20 text-stone-500 font-mono animate-pulse"
              role="status"
            >
              Loading sessions...
            </p>
          ) : sessions.length === 0 ? (
            <div className="text-center py-20">
              <h2 className="text-xl font-bold text-stone-300 mb-2">
                No sessions found
              </h2>
              <p className="text-stone-400 text-sm">
                Create a new session from the timeline.
              </p>
            </div>
          ) : visibleSessions.length === 0 ? (
            <div className="text-center py-20">
              <h2 className="text-xl font-bold text-stone-300 mb-2">
                No sessions match the filters
              </h2>
              <Button
                variant="ghost"
                onClick={() => {
                  setModelFilter("");
                  setErrorsOnly(false);
                }}
                className="h-auto rounded-xl bg-stone-800 px-4 py-2 text-sm text-white hover:bg-stone-700 dark:hover:bg-stone-700 hover:text-white"
              >
                Clear filters
              </Button>
            </div>
          ) : (
            <>
            {isFiltered && (
              <p className="mb-4 font-mono text-xs text-stone-500" role="status">
                {visibleSessions.length} of {sessions.length} sessions
              </p>
            )}
            <ul className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {visibleSessions.map((s) => {
                const title = titleOf(s);
                return (
                  <li
                    // The file path is the unique identity — a copied .jsonl
                    // keeps its header id, so ids can collide.
                    key={s.file}
                    className="group bg-stone-900/40 hover:bg-stone-800/60 backdrop-blur-xl border border-white/5 hover:border-amber-500/30 p-5 rounded-3xl transition-all duration-300 relative overflow-hidden"
                  >
                    <div className="flex justify-between items-start gap-2 mb-3">
                      {/* Stretched button: the whole card activates it, but it stays a real
                          button in the a11y tree and never nests the row actions inside it.
                          It opts out of the shared press nudge — a translate would make the
                          button a containing block, shrinking the stretched ::after to the
                          button's own box between mousedown and mouseup, so the click would
                          land on the card instead of here. */}
                      <h2 className="min-w-0 flex-1 text-lg font-bold">
                        <Button
                          variant="ghost"
                          data-session-card
                          onClick={() => handleSessionClick(s.file)}
                          className="h-auto w-full justify-start rounded-none bg-transparent p-0 text-left text-lg font-bold text-stone-200 hover:bg-transparent dark:hover:bg-transparent hover:text-amber-300 group-hover:text-amber-300 focus-visible:border-transparent focus-visible:ring-0 active:translate-none! after:absolute after:inset-0 after:rounded-3xl after:content-[''] focus-visible:after:ring-2 focus-visible:after:ring-amber-400/70"
                        >
                          <span className="truncate">{title}</span>
                        </Button>
                      </h2>
                      <div className="relative z-10 flex shrink-0 gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={(e) => togglePin(e, s)}
                          className={
                            pinnedFiles.has(s.file)
                              ? "bg-amber-500/15 text-amber-400 hover:bg-amber-500/25 dark:hover:bg-amber-500/25 hover:text-amber-300 rounded-xl"
                              : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100 bg-black/20 hover:bg-amber-500/20 dark:hover:bg-amber-500/20 text-stone-400 hover:text-amber-400 rounded-xl"
                          }
                          title={pinnedFiles.has(s.file) ? "Unpin session" : "Pin session"}
                          aria-label={`${pinnedFiles.has(s.file) ? "Unpin" : "Pin"} "${title}"`}
                          aria-pressed={pinnedFiles.has(s.file)}
                        >
                          <Pin
                            className={`w-4 h-4 ${pinnedFiles.has(s.file) ? "fill-current" : ""}`}
                            aria-hidden="true"
                          />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={(e) => handleResumeClick(e, s.file)}
                          className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 bg-black/20 hover:bg-amber-500/20 dark:hover:bg-amber-500/20 text-stone-400 hover:text-amber-400 rounded-xl"
                          title="Resume in terminal"
                          aria-label={`Resume "${title}" in terminal`}
                        >
                          <Terminal className="w-4 h-4" aria-hidden="true" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={(e) => handleDeleteClick(e, s)}
                          className="rounded-xl opacity-0 group-hover:opacity-100 focus-visible:opacity-100 bg-black/20 hover:bg-red-500/20 dark:hover:bg-red-500/20 text-stone-400 hover:text-red-400"
                          title="Delete session"
                          aria-label={`Delete "${title}"`}
                        >
                          <Trash2 className="w-4 h-4" aria-hidden="true" />
                        </Button>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 text-xs font-mono text-stone-500 mb-4 relative z-10 pointer-events-none">
                      <Folder className="w-3 h-3" aria-hidden="true" />
                      <span className="truncate" title={s.cwd}>
                        {shortenPath(s.cwd)}
                      </span>
                    </div>

                    <div className="flex items-center justify-between mt-auto pt-4 border-t border-white/5 relative z-10 pointer-events-none">
                      <div className="text-[10px] uppercase tracking-wider text-stone-500 font-bold group-hover:text-amber-500/50 transition-colors">
                        {new Date(
                          s.updatedAt || s.createdAt,
                        ).toLocaleTimeString()}
                      </div>

                      {/* Activity visualizer */}
                      <div className="flex items-center gap-2 font-mono text-xs">
                        {s.hasError && (
                          <span
                            className="rounded-md bg-red-500/15 px-1.5 py-0.5 text-[10px] font-bold text-red-400"
                            title="An assistant turn in this session ended in an error"
                          >
                            error
                          </span>
                        )}
                        {s.cost > 0 && (
                          <span
                            className="text-stone-500"
                            title="Total cost recorded in this session"
                          >
                            {formatCost(s.cost)}
                          </span>
                        )}
                        <span className="text-stone-600" title="Session file size">
                          {formatBytes(s.size)}
                        </span>
                        <span className="font-bold text-amber-500/70">
                          Messages:
                          {s.messageCount}
                        </span>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
            </>
          )}
        </div>
      </div>

      {openSessionFile && (
        <ChatModal file={openSessionFile} onClose={closeSession} />
      )}

      <Dialog
        open={pendingDelete !== null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
      >
        <DialogContent className="border border-white/10 bg-stone-950/95 backdrop-blur-2xl sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete this session?</DialogTitle>
            <DialogDescription>
              {pendingDelete && (
                <>
                  <span className="text-stone-200">
                    “{titleOf(pendingDelete)}”
                  </span>{" "}
                  and its {pendingDelete.messageCount}{" "}
                  {pendingDelete.messageCount === 1 ? "message" : "messages"}{" "}
                  will be removed from{" "}
                  <span className="font-mono break-all">
                    {shortenPath(pendingDelete.cwd)}
                  </span>
                  . This cannot be undone.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>
              Cancel
            </DialogClose>
            <Button variant="destructive" onClick={deleteSession}>
              <Trash2 aria-hidden="true" /> Delete session
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
