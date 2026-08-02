"use client";

import { useState, useEffect, useRef } from "react";
import { Terminal, Folder, X, Pencil, Check, ChevronDown, ChevronUp, RefreshCw } from "lucide-react";
import { Message, SessionDetail } from "@/types";

function MessageItem({ m, formatDate, onEdit }: { m: Message; formatDate: (d: string) => string; onEdit?: (id: string, text: string) => void }) {
  const isTool = m.role === "toolResult" || (m.toolName && (m.toolName.includes("bash") || m.toolName.includes("read")));
  const [isOpen, setIsOpen] = useState(!isTool);
  const [isEditing, setIsEditing] = useState(false);
  const [editVal, setEditVal] = useState(m.text);

  const handleSave = () => {
    if (editVal !== m.text && onEdit) {
      onEdit(m.id, editVal);
    }
    setIsEditing(false);
  };

  return (
    <article
      className={`group/msg p-5 rounded-2xl border backdrop-blur-md transition-all ${
        m.role === "user"
          ? "bg-amber-950/40 border-amber-500/30 ml-0 md:ml-12 shadow-[0_4_20px_rgba(59,130,246,0.1)]"
          : m.role === "assistant"
          ? "bg-orange-950/20 border-orange-500/30 mr-0 md:mr-12 shadow-[0_4_20px_rgba(16,185,129,0.05)]"
          : m.role === "summary"
          ? "bg-transparent border-white/5 text-stone-400 italic text-center mx-auto max-w-lg"
          : "bg-stone-900/60 border-white/10 opacity-80"
      }`}
    >
      {m.role !== "summary" && (
        <div 
          className={`flex items-center justify-between mb-3 ${isTool ? "cursor-pointer group select-none" : ""}`}
          onClick={() => isTool && setIsOpen(!isOpen)}
        >
          <div className={`text-xs font-bold uppercase tracking-wider flex items-center gap-2 ${
            m.role === "user" ? "text-amber-400" :
            m.role === "assistant" ? "text-orange-400" :
            "text-stone-400"
          }`}>
            {m.role === "toolResult" ? m.toolName || "Tool Result" : m.role}
            {m.role === "user" && onEdit && !isEditing && (
              <button 
                onClick={(e) => { e.stopPropagation(); setIsEditing(true); setEditVal(m.text); }}
                className="opacity-0 group-hover/msg:opacity-100 hover:text-amber-200 transition-opacity ml-1 p-1 bg-black/20 rounded-md"
                title="Edit message"
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <div className="flex items-center gap-3">
            <div className="text-[10px] text-stone-500 font-mono">{formatDate(m.timestamp)}</div>
            {isTool && (
              <span className="p-1 rounded-full bg-white/5 group-hover:bg-white/10 transition-colors text-stone-400 flex items-center justify-center">
                {isOpen ? <ChevronUp className="w-3.5 h-3.5"/> : <ChevronDown className="w-3.5 h-3.5"/>}
              </span>
            )}
          </div>
        </div>
      )}
      {isEditing ? (
        <div className="mt-2 flex flex-col gap-2">
          <textarea
            value={editVal}
            onChange={(e) => setEditVal(e.target.value)}
            className="w-full bg-black/40 border border-amber-500/50 rounded-xl px-4 py-3 text-stone-200 focus:outline-none focus:ring-1 focus:ring-amber-500/50 shadow-inner custom-scrollbar min-h-[100px]"
          />
          <div className="flex justify-end gap-2">
            <button onClick={() => setIsEditing(false)} className="px-3 py-1.5 text-xs text-stone-400 hover:text-white transition-colors">Cancel</button>
            <button onClick={handleSave} className="flex items-center gap-1.5 px-4 py-1.5 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-xs font-bold transition-all shadow-md">
              <Check className="w-3.5 h-3.5" /> Save
            </button>
          </div>
        </div>
      ) : (
        <div className={`text-stone-200 text-sm whitespace-pre-wrap break-words leading-relaxed relative transition-all duration-300 ${
          isTool && !isOpen ? "max-h-24 overflow-hidden" : ""
        }`}>
          {m.text || "[no text content]"}
          {isTool && !isOpen && (
            <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-stone-900/90 to-transparent pointer-events-none" />
          )}
        </div>
      )}
    </article>
  );
}

export default function ChatModal({ file, onClose }: { file: string; onClose: () => void }) {
  const [sessionDetail, setSessionDetail] = useState<SessionDetail | null>(null);
  const [hideToolCalls, setHideToolCalls] = useState(true);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameInput, setRenameInput] = useState("");
  const [chatInput, setChatInput] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const saved = localStorage.getItem("piSessionBrowser_hideToolCalls");
    if (saved !== null) setHideToolCalls(saved === "true");
  }, []);

  const toggleHideToolCalls = (val: boolean) => {
    setHideToolCalls(val);
    localStorage.setItem("piSessionBrowser_hideToolCalls", String(val));
  };

  useEffect(() => {
    let eventSource = new EventSource(`/api/stream?file=${encodeURIComponent(file)}`);
    
    eventSource.onmessage = (event) => {
      try {
        const detail = JSON.parse(event.data);
        setSessionDetail(detail);
      } catch (e) {
        console.error("Failed to parse SSE data", e);
      }
    };
    return () => eventSource.close();
  }, [file]);

  useEffect(() => {
    if (sessionDetail) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [sessionDetail?.items.length]);

  const handleEditMessage = async (messageId: string, newText: string) => {
    if (!sessionDetail) return;
    try {
      const res = await fetch("/api/message/edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file: sessionDetail.file, messageId, newText })
      });
      if (!res.ok) throw new Error("Failed to edit message");
    } catch (e: any) {
      alert(e.message);
    }
  };

  const handleRenameSubmit = async () => {
    if (!sessionDetail) return;
    setIsRenaming(false);
    if (!renameInput.trim() || renameInput === sessionDetail.name) return;
    try {
      const res = await fetch("/api/session/rename", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file: sessionDetail.file, name: renameInput })
      });
      if (!res.ok) throw new Error("Failed to rename session");
    } catch (e: any) {
      alert(e.message);
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || !sessionDetail) return;
    
    const message = chatInput.trim();
    setChatInput("");
    setIsThinking(true);
    
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file: sessionDetail.file, message })
      });
      if (!res.ok) {
        let errMsg = "Failed to send message";
        try { const data = await res.json(); if (data.error) errMsg = data.error; } catch (e) {}
        throw new Error(errMsg);
      }
    } catch (err: any) {
      alert(err.message);
    } finally {
      setIsThinking(false);
    }
  };

  const formatDate = (d: string) => new Date(d).toLocaleString();

  return (
    <div className="absolute inset-4 md:inset-12 md:right-12 right-4 bottom-4 md:bottom-12 pointer-events-none z-40 flex items-end justify-end">
      {/* Backdrop click to close */}
      <div 
        className="fixed inset-0 pointer-events-auto cursor-zoom-out bg-black/20 backdrop-blur-sm" 
        onClick={onClose}
      />
      
      <div className="w-full md:w-[600px] lg:w-[800px] h-full md:h-[90%] bg-stone-950/80 backdrop-blur-3xl rounded-[2rem] border border-white/10 shadow-[0_20px_80px_rgba(0,0,0,0.8)] pointer-events-auto flex flex-col overflow-hidden relative animate-in fade-in slide-in-from-bottom-8 duration-500 ease-out">
        {/* Header */}
        <div className="p-6 md:p-8 border-b border-white/10 bg-gradient-to-b from-white/5 to-transparent flex flex-col md:flex-row md:items-start justify-between gap-6 shrink-0 relative">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 mb-3 group/header">
              <div className="p-2 bg-amber-500/20 rounded-xl border border-amber-500/30">
                <Terminal className="w-5 h-5 text-amber-400" />
              </div>
              {isRenaming ? (
                <input
                  autoFocus
                  value={renameInput}
                  onChange={(e) => setRenameInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleRenameSubmit();
                    if (e.key === "Escape") setIsRenaming(false);
                  }}
                  onBlur={handleRenameSubmit}
                  className="text-2xl font-bold text-white bg-black/50 border border-amber-500/50 rounded-lg px-2 py-1 outline-none w-full max-w-sm"
                />
              ) : (
                <>
                  <h2 
                    className="text-2xl font-bold text-white truncate cursor-pointer hover:text-amber-200 transition-colors"
                    onClick={() => { setIsRenaming(true); setRenameInput(sessionDetail?.name || sessionDetail?.preview || ""); }}
                  >
                    {sessionDetail ? (sessionDetail.name || sessionDetail.preview || "Untitled Session") : "Initializing Session..."}
                  </h2>
                  <button 
                    className="opacity-0 group-hover/header:opacity-100 text-stone-400 hover:text-amber-300 transition-opacity p-1"
                    onClick={() => { setIsRenaming(true); setRenameInput(sessionDetail?.name || sessionDetail?.preview || ""); }}
                    title="Rename Session"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                </>
              )}
            </div>
            <div className="flex flex-col gap-1.5 font-mono text-xs text-stone-400">
              <div className="flex items-center gap-2 truncate text-amber-200">
                <Folder className="w-3.5 h-3.5" /> {sessionDetail?.cwd || "..."}
              </div>
              <div className="text-stone-500 truncate ml-5 opacity-50">
                {sessionDetail?.file || "..."}
              </div>
            </div>
          </div>
          
          <div className="flex flex-col items-end gap-4 shrink-0">
            <button 
              onClick={onClose}
              className="p-2 bg-white/5 hover:bg-white/20 rounded-full transition-colors self-end"
            >
              <X className="w-5 h-5 text-stone-300" />
            </button>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-xs font-semibold text-stone-400 uppercase tracking-widest cursor-pointer hover:text-white transition-colors">
                <input 
                  type="checkbox" 
                  checked={hideToolCalls}
                  onChange={(e) => toggleHideToolCalls(e.target.checked)}
                  className="accent-amber-500 w-3.5 h-3.5"
                />
                Hide tool calls
              </label>
            </div>
          </div>
        </div>
        
        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-6 md:p-8 custom-scrollbar">
          <div className="flex flex-col gap-6 max-w-4xl mx-auto">
            {sessionDetail && (
              sessionDetail.items.filter(m => hideToolCalls ? m.role !== "toolResult" : true).length === 0 ? (
                <div className="flex items-center justify-center h-full text-stone-500">
                  <div className="text-center space-y-3">
                    <Terminal className="w-12 h-12 mx-auto text-stone-700 opacity-50" />
                    <p className="tracking-widest uppercase text-xs font-semibold">Void</p>
                  </div>
                </div>
              ) : (
                sessionDetail.items
                  .filter(m => hideToolCalls ? m.role !== "toolResult" : true)
                  .map((m) => (
                    <MessageItem key={m.id} m={m} formatDate={formatDate} onEdit={handleEditMessage} />
                  ))
              )
            )}
            <div ref={messagesEndRef} className="h-4" />
          </div>
        </div>
        
        {/* Chat Input */}
        <div className="p-4 md:p-6 bg-stone-900/80 backdrop-blur-xl border-t border-white/10 shrink-0">
          {isThinking && (
            <div className="mb-3 flex items-center justify-between text-xs text-amber-400 font-mono">
              <span className="flex items-center gap-2"><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Pi is thinking...</span>
            </div>
          )}
          <form onSubmit={handleSendMessage} className="flex gap-3 relative">
            <input
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              placeholder="Send a message to this session..."
              className="flex-1 bg-black/40 border border-white/10 rounded-2xl px-5 py-4 text-stone-200 focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/50 shadow-inner placeholder-stone-500 transition-all"
            />
            <button
              type="submit"
              disabled={!chatInput.trim()}
              className="px-6 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 disabled:hover:bg-amber-600 text-white rounded-2xl font-bold transition-all shadow-lg flex items-center justify-center"
            >
              Send
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
