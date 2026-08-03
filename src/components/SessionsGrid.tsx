"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Folder, Trash2, ArrowLeft, RefreshCw } from "lucide-react";
import { SessionInfo } from "@/types";
import { formatReadableDate } from "@/lib/utils";
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
      const res = await fetch(`/api/session?file=${encodeURIComponent(file)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error("Failed to delete session");
      fetchSessions();
    } catch (err) {
      console.error(err);
      fetchSessions();
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
          <button
            onClick={() => router.push(`/?${searchParams.toString()}`)}
            className="flex items-center gap-2 px-4 py-2 bg-stone-900/60 hover:bg-stone-800/80 border border-white/10 rounded-xl text-stone-300 hover:text-white transition-all backdrop-blur-md group"
          >
            <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
            Back
          </button>
          <h1 className="text-3xl font-extrabold text-white flex items-center gap-3 drop-shadow-lg">
            {formatReadableDate(date)}
          </h1>
        </div>
        <div className="flex items-center gap-4 w-full md:w-auto">
          <button 
            onClick={fetchSessions}
            className="p-3 bg-stone-900/60 hover:bg-stone-800 border border-white/10 rounded-xl text-stone-300 hover:text-white transition-all backdrop-blur-md group"
            title="Refresh"
          >
            <RefreshCw className={`w-5 h-5 ${loading ? "animate-spin" : "group-hover:rotate-180 transition-transform duration-500"}`} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto w-full custom-scrollbar">
        <div className="max-w-7xl mx-auto p-6 md:p-8">
          {loading ? (
            <div className="text-center py-20 text-stone-500 font-mono animate-pulse">Loading sessions...</div>
          ) : sessions.length === 0 ? (
            <div className="text-center py-20">
              <h3 className="text-xl font-bold text-stone-300 mb-2">No sessions found</h3>
              <p className="text-stone-400 text-sm">Create a new session from the timeline.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {sessions.map((s) => (
                <div
                  key={s.id}
                  onClick={() => handleSessionClick(s.file)}
                  className="group bg-stone-900/40 hover:bg-stone-800/60 backdrop-blur-xl border border-white/5 hover:border-amber-500/30 p-5 rounded-3xl cursor-pointer transition-all duration-300 relative overflow-hidden"
                >
                  <div className="flex justify-between items-start mb-3 relative z-10">
                    <h3 className="text-lg font-bold text-stone-200 group-hover:text-amber-300 transition-colors truncate pr-12">
                      {s.name || s.preview || "Untitled Session"}
                    </h3>
                    <button
                      onClick={(e) => handleDeleteClick(e, s.file)}
                      className={`absolute right-0 top-0 p-2 rounded-xl transition-all ${
                        confirmDelete === s.file 
                          ? "bg-red-500/20 text-red-400 hover:bg-red-500/40" 
                          : "opacity-0 group-hover:opacity-100 bg-black/20 hover:bg-red-500/20 text-stone-400 hover:text-red-400"
                      }`}
                      title={confirmDelete === s.file ? "Click again to confirm" : "Delete session"}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                  
                  <div className="flex items-center gap-2 text-xs font-mono text-stone-500 mb-4 relative z-10">
                    <Folder className="w-3 h-3" />
                    <span className="truncate">{s.cwd}</span>
                  </div>
                  
                  <div className="flex items-center justify-between mt-auto pt-4 border-t border-white/5 relative z-10">
                    <div className="text-[10px] uppercase tracking-wider text-stone-500 font-bold group-hover:text-amber-500/50 transition-colors">
                      {new Date(s.updatedAt || s.createdAt).toLocaleTimeString()}
                    </div>
                    
                    {/* Activity visualizer */}
                    <div className="flex items-center gap-2">
                      <div className="text-xs font-mono font-bold text-amber-500/70">{s.messageCount}</div>
                      <div className="w-8 h-8 rounded-full border border-white/10 flex items-center justify-center relative bg-black/20">
                        <svg className="w-full h-full -rotate-90 transform absolute inset-0">
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
                </div>
              ))}
            </div>
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
