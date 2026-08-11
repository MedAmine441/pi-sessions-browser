"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Folder, Trash2, ArrowLeft, RefreshCw, Terminal } from "lucide-react";
import { SessionInfo } from "@/types";
import {
  announceLocationsChanged,
  fetchJson,
  formatBytes,
  formatCost,
  formatReadableDate,
  messageOf,
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
      console.error(err);
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
        <div className="flex items-center gap-4 w-full md:w-auto">
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
          ) : (
            <ul className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {sessions.map((s) => {
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
