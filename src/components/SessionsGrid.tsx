"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Folder, Trash2, ArrowLeft, RefreshCw, Terminal } from "lucide-react";
import { SessionInfo } from "@/types";
import { formatReadableDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import ChatModal from "./ChatModal";

export default function SessionsGrid({ date }: { date: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  // Read open session from query param ?session=file
  const openSessionFile = searchParams.get("session");
  const location = searchParams.get("location") || "";

  const fetchSessions = async () => {
    setLoading(true);
    try {
      let url = `/api/sessions?date=${encodeURIComponent(date)}`;
      if (location) {
        url += `&location=${encodeURIComponent(location)}`;
      }
      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to fetch sessions");
      const data = await res.json();
      setSessions(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSessions();
  }, [date, location]);

  const handleDeleteClick = async (e: React.MouseEvent, file: string) => {
    e.preventDefault();
    e.stopPropagation();

    if (confirmDelete !== file) {
      setConfirmDelete(file);
      return;
    }

    setConfirmDelete(null);
    setSessions(prev => prev.filter(s => s.file !== file));

    try {
      const res = await fetch(`/api/sessions?file=${encodeURIComponent(file)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error("Failed to delete session");
      fetchSessions();
    } catch (err) {
      console.error(err);
      fetchSessions();
    }
  };

  const handleResumeClick = async (e: React.MouseEvent, file: string) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      const res = await fetch("/api/resume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file })
      });
      if (!res.ok) throw new Error("Failed to resume session");
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleSessionClick = (file: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("session", file);
    router.replace(`/${encodeURIComponent(date)}?${params.toString()}`);
  };

  const closeSession = () => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("session");
    router.replace(`/${encodeURIComponent(date)}?${params.toString()}`);
    fetchSessions(); // Refresh list to get new preview/counts
  };

  const maxMsgs = useMemo(() => {
    if (!sessions.length) return 1;
    return Math.max(...sessions.map(s => s.messageCount), 1);
  }, [sessions]);

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
            <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" aria-hidden="true" />
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
            onClick={fetchSessions}
            className="group size-11 bg-stone-900/60 hover:bg-stone-800 dark:hover:bg-stone-800 border-white/10 rounded-xl text-stone-300 hover:text-white backdrop-blur-md"
            title="Refresh"
            aria-label="Refresh sessions"
          >
            <RefreshCw className={`w-5 h-5 ${loading ? "animate-spin" : "group-hover:rotate-180 transition-transform duration-500"}`} aria-hidden="true" />
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto w-full custom-scrollbar">
        <div className="max-w-7xl mx-auto p-6 md:p-8">
          {loading ? (
            <p className="text-center py-20 text-stone-500 font-mono animate-pulse" role="status">Loading sessions...</p>
          ) : sessions.length === 0 ? (
            <div className="text-center py-20">
              <h2 className="text-xl font-bold text-stone-300 mb-2">No sessions found</h2>
              <p className="text-stone-400 text-sm">Create a new session from the timeline.</p>
            </div>
          ) : (
            <ul className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {sessions.map((s) => {
                const title = s.name || s.preview || "Untitled Session";
                return (
                  <li
                    key={s.id}
                    className="group bg-stone-900/40 hover:bg-stone-800/60 backdrop-blur-xl border border-white/5 hover:border-amber-500/30 p-5 rounded-3xl transition-all duration-300 relative overflow-hidden"
                  >
                    <div className="flex justify-between items-start gap-2 mb-3">
                      {/* Stretched button: the whole card activates it, but it stays a real
                          button in the a11y tree and never nests the row actions inside it. */}
                      <h2 className="min-w-0 flex-1 text-lg font-bold">
                        <Button
                          variant="ghost"
                          onClick={() => handleSessionClick(s.file)}
                          className="h-auto w-full justify-start rounded-none bg-transparent p-0 text-left text-lg font-bold text-stone-200 hover:bg-transparent dark:hover:bg-transparent hover:text-amber-300 group-hover:text-amber-300 focus-visible:border-transparent focus-visible:ring-0 after:absolute after:inset-0 after:rounded-3xl after:content-[''] focus-visible:after:ring-2 focus-visible:after:ring-amber-400/70"
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
                          onClick={(e) => handleDeleteClick(e, s.file)}
                          className={`rounded-xl ${
                            confirmDelete === s.file
                              ? "bg-red-500/20 text-red-400 hover:bg-red-500/40 dark:hover:bg-red-500/40 hover:text-red-300"
                              : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100 bg-black/20 hover:bg-red-500/20 dark:hover:bg-red-500/20 text-stone-400 hover:text-red-400"
                          }`}
                          title={confirmDelete === s.file ? "Click again to confirm" : "Delete session"}
                          aria-label={
                            confirmDelete === s.file
                              ? `Confirm deletion of "${title}"`
                              : `Delete "${title}"`
                          }
                        >
                          <Trash2 className="w-4 h-4" aria-hidden="true" />
                        </Button>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 text-xs font-mono text-stone-500 mb-4 relative z-10 pointer-events-none">
                      <Folder className="w-3 h-3" aria-hidden="true" />
                      <span className="truncate">{s.cwd}</span>
                    </div>

                    <div className="flex items-center justify-between mt-auto pt-4 border-t border-white/5 relative z-10 pointer-events-none">
                      <div className="text-[10px] uppercase tracking-wider text-stone-500 font-bold group-hover:text-amber-500/50 transition-colors">
                        {new Date(s.updatedAt || s.createdAt).toLocaleTimeString()}
                      </div>

                      {/* Activity visualizer */}
                      <div className="flex items-center gap-2">
                        <div className="text-xs font-mono font-bold text-amber-500/70">
                          <span className="sr-only">Messages: </span>{s.messageCount}
                        </div>
                        <div className="w-8 h-8 rounded-full border border-white/10 flex items-center justify-center relative bg-black/20">
                          <svg className="w-full h-full -rotate-90 transform absolute inset-0" aria-hidden="true">
                            <circle cx="16" cy="16" r="14" fill="none" stroke="currentColor" strokeWidth="2" className="text-white/5" />
                            <circle
                              cx="16" cy="16" r="14" fill="none" stroke="currentColor" strokeWidth="2"
                              className="text-amber-500 transition-all duration-1000 ease-out"
                              strokeDasharray={`${Math.max((s.messageCount / maxMsgs) * 88, 4)} 88`}
                            />
                          </svg>
                        </div>
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
        <ChatModal
          file={openSessionFile}
          onClose={closeSession}
        />
      )}
    </div>
  );
}
