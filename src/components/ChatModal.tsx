"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Terminal, Folder, X, Pencil, Check, ChevronDown, ChevronUp, RefreshCw, Cpu, GitFork, FileDown, Archive } from "lucide-react";
import { Message, SessionDetail, SessionModel } from "@/types";
import { fetchJson, localDateKey, messageOf } from "@/lib/utils";
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
import { toast } from "@/components/ui/toast";
import { ModelDialog } from "@/components/PiControls";

function MessageItem({ m, formatDate, onEdit }: { m: Message; formatDate: (d?: string) => string; onEdit?: (id: string, text: string) => void }) {
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

  const toolLabel = m.role === "toolResult" ? m.toolName || "Tool Result" : m.role;

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
        <div className={`flex items-center justify-between mb-3 ${isTool ? "relative select-none" : ""}`}>
          <div className={`text-xs font-bold uppercase tracking-wider flex items-center gap-2 ${
            m.role === "user" ? "text-amber-400" :
            m.role === "assistant" ? "text-orange-400" :
            "text-stone-400"
          }`}>
            {toolLabel}
            {m.role === "user" && onEdit && !isEditing && (
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={(e) => { e.stopPropagation(); setIsEditing(true); setEditVal(m.text); }}
                className="relative z-10 ml-1 opacity-0 group-hover/msg:opacity-100 focus-visible:opacity-100 bg-black/20 hover:bg-black/40 dark:hover:bg-black/40 text-current hover:text-amber-200 rounded-md"
                title="Edit message"
                aria-label="Edit message"
              >
                <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
              </Button>
            )}
          </div>
          <div className="flex items-center gap-3">
            <div className="text-[10px] text-stone-500 font-mono">{formatDate(m.timestamp)}</div>
            {isTool && (
              /* Stretched toggle: the whole header row activates it, while staying a
                 single real button with an expanded state in the a11y tree. The press
                 nudge is off for the same reason as the session card: translating the
                 button would re-anchor its stretched ::after to the button itself
                 mid-click, so the release would miss it. */
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => setIsOpen(!isOpen)}
                aria-expanded={isOpen}
                aria-label={`${isOpen ? "Collapse" : "Expand"} ${toolLabel} output`}
                className="rounded-full bg-white/5 hover:bg-white/10 dark:hover:bg-white/10 text-stone-400 hover:text-stone-200 active:translate-none! after:absolute after:inset-0 after:content-['']"
              >
                {isOpen ? <ChevronUp className="w-3.5 h-3.5" aria-hidden="true" /> : <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" />}
              </Button>
            )}
          </div>
        </div>
      )}
      {isEditing ? (
        <div className="mt-2 flex flex-col gap-2">
          <textarea
            value={editVal}
            onChange={(e) => setEditVal(e.target.value)}
            onKeyDown={(e) => {
              // Cancel the edit only — without stopPropagation the document
              // listener would close the whole modal on the same keypress.
              if (e.key === "Escape") {
                e.stopPropagation();
                setIsEditing(false);
              }
            }}
            aria-label="Message text"
            className="w-full bg-black/40 border border-amber-500/50 rounded-xl px-4 py-3 text-stone-200 focus:outline-none focus:ring-1 focus:ring-amber-500/50 shadow-inner custom-scrollbar min-h-[100px]"
          />
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              onClick={() => setIsEditing(false)}
              className="h-auto px-3 py-1.5 text-xs text-stone-400 hover:bg-white/5 dark:hover:bg-white/5 hover:text-white"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              className="h-auto gap-1.5 px-4 py-1.5 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-xs font-bold shadow-md"
            >
              <Check className="w-3.5 h-3.5" aria-hidden="true" /> Save
            </Button>
          </div>
        </div>
      ) : (
        <div className={`text-stone-200 text-sm whitespace-pre-wrap break-words leading-relaxed relative transition-all duration-300 ${
          isTool && !isOpen ? "max-h-24 overflow-hidden" : ""
        }`}>
          {m.text || "[no text content]"}
          {isTool && !isOpen && (
            <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-stone-900/90 to-transparent pointer-events-none" aria-hidden="true" />
          )}
        </div>
      )}
    </article>
  );
}

/** What /api/stream sends: one snapshot, then only what changed. */
type StreamPayload =
  | { kind: "snapshot"; detail: SessionDetail }
  | {
      kind: "append";
      items: Message[];
      name?: string | null;
      model?: SessionModel;
    }
  | { kind: "gone" };

export default function ChatModal({ file, onClose }: { file: string; onClose: (discardIfEmpty?: boolean) => void }) {
  const [sessionDetail, setSessionDetail] = useState<SessionDetail | null>(null);
  const [sessionGone, setSessionGone] = useState(false);
  const [hideToolCalls, setHideToolCalls] = useState(
    () =>
      typeof window === "undefined" ||
      localStorage.getItem("piSessionBrowser_hideToolCalls") !== "false",
  );
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameInput, setRenameInput] = useState("");
  const [chatInput, setChatInput] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const [pickingModel, setPickingModel] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isCompacting, setIsCompacting] = useState(false);
  const [compactOpen, setCompactOpen] = useState(false);
  const [compactInstructions, setCompactInstructions] = useState("");

  const messagesEndRef = useRef<HTMLDivElement>(null);
  // Pi owns the file once it is running in a terminal, so it must not be
  // thrown away for being empty.
  const resumedRef = useRef(false);

  const close = useCallback(() => onClose(!resumedRef.current), [onClose]);

  const toggleHideToolCalls = (val: boolean) => {
    setHideToolCalls(val);
    localStorage.setItem("piSessionBrowser_hideToolCalls", String(val));
  };

  useEffect(() => {
    const eventSource = new EventSource(`/api/stream?file=${encodeURIComponent(file)}`);

    eventSource.onmessage = (event) => {
      try {
        const payload: StreamPayload = JSON.parse(event.data);
        if (payload.kind === "snapshot") {
          setSessionGone(false);
          setSessionDetail(payload.detail);
        } else if (payload.kind === "append") {
          setSessionDetail((prev) => {
            if (!prev) return prev;
            const items = [...prev.items];
            const indexById = new Map(items.map((item, i) => [item.id, i]));
            for (const item of payload.items) {
              const at = indexById.get(item.id);
              if (at === undefined) {
                indexById.set(item.id, items.length);
                items.push(item);
              } else {
                items[at] = item;
              }
            }
            return {
              ...prev,
              items,
              ...(payload.name !== undefined ? { name: payload.name } : {}),
              ...(payload.model !== undefined ? { model: payload.model } : {}),
            };
          });
        } else if (payload.kind === "gone") {
          // Deleted, renamed away, or too large to stream — nothing more will come.
          setSessionGone(true);
        }
      } catch (e) {
        console.error("Failed to parse SSE data", e);
      }
    };
    return () => eventSource.close();
  }, [file]);

  const itemCount = sessionDetail?.items.length ?? 0;
  useEffect(() => {
    if (itemCount > 0) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [itemCount]);

  // Escape closes the dialog, matching the backdrop click.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [close]);

  const handleEditMessage = async (messageId: string, newText: string) => {
    if (!sessionDetail) return;
    try {
      const res = await fetch("/api/message/edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file: sessionDetail.file, messageId, newText })
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "Failed to edit message");
      }
    } catch (e) {
      toast(messageOf(e));
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
    } catch (e) {
      toast(messageOf(e));
    }
  };

  const handleResumeClick = async () => {
    if (!sessionDetail) return;
    try {
      const res = await fetch("/api/resume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file: sessionDetail.file })
      });
      if (!res.ok) throw new Error("Failed to resume session");
      resumedRef.current = true;
    } catch (err) {
      toast(messageOf(err));
    }
  };

  const router = useRouter();

  /** The /fork counterpart: copy the whole session and continue in the copy. */
  const handleFork = async () => {
    if (!sessionDetail) return;
    try {
      const data = await fetchJson<{ file: string }>("/api/session/fork", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file: sessionDetail.file }),
      });
      toast("Forked — you are now in the copy; the original is untouched.");
      const params = new URLSearchParams(window.location.search);
      if (sessionDetail.cwd) params.set("location", sessionDetail.cwd);
      params.set("session", data.file);
      const today = localDateKey(new Date());
      router.push(`/${encodeURIComponent(today)}?${params.toString()}`);
    } catch (err) {
      toast(messageOf(err));
    }
  };

  /** The /export counterpart: pi renders its own HTML; download it. */
  const handleExport = async () => {
    if (!sessionDetail || isExporting) return;
    setIsExporting(true);
    try {
      const res = await fetch(
        `/api/session/export?file=${encodeURIComponent(sessionDetail.file)}`,
      );
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "Failed to export session");
      }
      const blob = await res.blob();
      const match = (res.headers.get("Content-Disposition") || "").match(
        /filename="([^"]+)"/,
      );
      const anchor = document.createElement("a");
      anchor.href = URL.createObjectURL(blob);
      anchor.download = match?.[1] || "session.html";
      anchor.click();
      URL.revokeObjectURL(anchor.href);
    } catch (err) {
      toast(messageOf(err));
    } finally {
      setIsExporting(false);
    }
  };

  /** The /compact counterpart: pi summarizes older context via RPC. */
  const handleCompact = async () => {
    if (!sessionDetail || isCompacting) return;
    setCompactOpen(false);
    setIsCompacting(true);
    try {
      await fetchJson("/api/session/compact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          file: sessionDetail.file,
          customInstructions: compactInstructions,
        }),
      });
      setCompactInstructions("");
      toast("Session compacted.");
    } catch (err) {
      toast(messageOf(err));
    } finally {
      setIsCompacting(false);
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    // One pi process per session at a time: a second send against the same
    // file would contend with the run already writing to it.
    if (isThinking || sessionGone || !chatInput.trim() || !sessionDetail) return;

    const message = chatInput.trim();
    setChatInput("");

    // Slash commands typed into the chat behave like pi's own.
    if (message === "/quit") {
      close();
      return;
    }
    if (message === "/fork") {
      handleFork();
      return;
    }
    if (message === "/export") {
      handleExport();
      return;
    }
    if (message === "/compact" || message.startsWith("/compact ")) {
      setCompactInstructions(message.slice("/compact".length).trim());
      setCompactOpen(true);
      return;
    }
    if (message === "/model") {
      setPickingModel(true);
      return;
    }
    if (message === "/name" || message.startsWith("/name ")) {
      const newName = message.slice("/name".length).trim();
      if (!newName) {
        startRename();
        return;
      }
      try {
        await fetchJson("/api/session/rename", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ file: sessionDetail.file, name: newName }),
        });
      } catch (err) {
        toast(messageOf(err));
      }
      return;
    }

    if (message === "/new") {
      try {
        // Carry on in the folder this session belongs to.
        const res = await fetch("/api/new-session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cwd: sessionDetail.cwd }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to create new session");

        close();
        if (data.file) {
          const today = localDateKey(new Date());
          // Keep search params like location and filters intact
          const params = new URLSearchParams(window.location.search);
          if (sessionDetail.cwd) params.set("location", sessionDetail.cwd);
          params.set("session", data.file);
          router.push(`/${encodeURIComponent(today)}?${params.toString()}`);
        }
      } catch (err) {
        toast(messageOf(err));
      }
      return;
    }

    setIsThinking(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file: sessionDetail.file, message })
      });
      if (!res.ok) {
        let errMsg = "Failed to send message";
        const data = await res.json().catch(() => null);
        if (data?.error) errMsg = data.error;
        throw new Error(errMsg);
      }
    } catch (err) {
      toast(messageOf(err));
    } finally {
      setIsThinking(false);
    }
  };

  // Compaction and branch entries can arrive without a timestamp; showing
  // nothing beats showing "Invalid Date".
  const formatDate = (d?: string) => {
    if (!d) return "";
    const date = new Date(d);
    return isNaN(date.getTime()) ? "" : date.toLocaleString();
  };

  const sessionTitle = sessionDetail
    ? (sessionDetail.name || sessionDetail.preview || "Untitled Session")
    : "Initializing Session...";

  const startRename = () => {
    setIsRenaming(true);
    setRenameInput(sessionDetail?.name || sessionDetail?.preview || "");
  };

  return (
    <div className="absolute inset-4 md:inset-12 md:right-12 right-4 bottom-4 md:bottom-12 pointer-events-none z-40 flex items-end justify-end">
      {/* Backdrop click to close */}
      <div
        className="fixed inset-0 pointer-events-auto cursor-zoom-out bg-black/20 backdrop-blur-sm"
        onClick={close}
        aria-hidden="true"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Session: ${sessionTitle}`}
        className="w-full md:w-[600px] lg:w-[800px] h-full md:h-[90%] bg-stone-950/80 backdrop-blur-3xl rounded-[2rem] border border-white/10 shadow-[0_20px_80px_rgba(0,0,0,0.8)] pointer-events-auto flex flex-col overflow-hidden relative animate-in fade-in slide-in-from-bottom-8 duration-500 ease-out"
      >
        {/* Header */}
        <div className="p-6 md:p-8 border-b border-white/10 bg-gradient-to-b from-white/5 to-transparent flex flex-col md:flex-row md:items-start justify-between gap-6 shrink-0 relative">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 mb-3 group/header">
              <div className="p-2 bg-amber-500/20 rounded-xl border border-amber-500/30">
                <Terminal className="w-5 h-5 text-amber-400" aria-hidden="true" />
              </div>
              {isRenaming ? (
                <input
                  autoFocus
                  value={renameInput}
                  onChange={(e) => setRenameInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleRenameSubmit();
                    if (e.key === "Escape") {
                      // Cancel the rename without also closing the modal.
                      e.stopPropagation();
                      setIsRenaming(false);
                    }
                  }}
                  onBlur={handleRenameSubmit}
                  aria-label="Session name"
                  className="text-2xl font-bold text-white bg-black/50 border border-amber-500/50 rounded-lg px-2 py-1 outline-none w-full max-w-sm"
                />
              ) : (
                <h2 className="min-w-0 flex-1">
                  <Button
                    variant="ghost"
                    onClick={startRename}
                    className="h-auto w-full justify-start gap-2 bg-transparent p-0 text-left text-2xl font-bold text-white hover:bg-transparent dark:hover:bg-transparent hover:text-amber-200"
                    title="Rename Session"
                    aria-label={`Rename session: ${sessionTitle}`}
                  >
                    <span className="truncate">{sessionTitle}</span>
                    <Pencil className="w-4 h-4 shrink-0 opacity-0 group-hover/header:opacity-100 transition-opacity" aria-hidden="true" />
                  </Button>
                </h2>
              )}
            </div>
            <div className="flex flex-col gap-1.5 font-mono text-xs text-stone-400">
              <div className="flex items-center gap-2 truncate text-amber-200">
                <Folder className="w-3.5 h-3.5" aria-hidden="true" /> {sessionDetail?.cwd || "..."}
              </div>
              <div className="text-stone-500 truncate ml-5 opacity-50">
                {sessionDetail?.file || "..."}
              </div>
              <Button
                variant="ghost"
                onClick={() => setPickingModel(true)}
                title="Change the model for this session"
                className="h-auto w-fit justify-start gap-1.5 rounded-lg bg-white/5 px-2 py-1 font-mono text-[11px] text-stone-300 hover:bg-white/10 dark:hover:bg-white/10 hover:text-amber-200"
              >
                <Cpu className="h-3 w-3 text-amber-400" aria-hidden="true" />
                <span className="truncate">
                  {sessionDetail?.model
                    ? `${sessionDetail.model.provider}/${sessionDetail.model.modelId}`
                    : "default model"}
                </span>
              </Button>
            </div>
          </div>

          <div className="flex flex-col items-end gap-4 shrink-0">
            <div className="flex items-center gap-2 self-end">
              <Button
                variant="ghost"
                size="icon"
                onClick={handleFork}
                disabled={!sessionDetail || sessionGone}
                className="rounded-full bg-white/5 hover:bg-white/20 dark:hover:bg-white/20 text-stone-300 hover:text-white"
                title="Fork session (/fork)"
                aria-label="Fork session"
              >
                <GitFork className="w-4 h-4" aria-hidden="true" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleExport}
                disabled={!sessionDetail || sessionGone || isExporting}
                className="rounded-full bg-white/5 hover:bg-white/20 dark:hover:bg-white/20 text-stone-300 hover:text-white"
                title="Export as HTML (/export)"
                aria-label="Export session as HTML"
              >
                <FileDown className={`w-4 h-4 ${isExporting ? "animate-pulse" : ""}`} aria-hidden="true" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setCompactOpen(true)}
                disabled={!sessionDetail || sessionGone || isThinking || isCompacting}
                className="rounded-full bg-white/5 hover:bg-white/20 dark:hover:bg-white/20 text-stone-300 hover:text-white"
                title="Compact session (/compact)"
                aria-label="Compact session"
              >
                <Archive className={`w-4 h-4 ${isCompacting ? "animate-pulse" : ""}`} aria-hidden="true" />
              </Button>
              <Button
                variant="ghost"
                onClick={handleResumeClick}
                className="h-auto gap-1.5 px-3 py-1.5 bg-amber-500/20 hover:bg-amber-500/40 dark:hover:bg-amber-500/40 text-amber-400 hover:text-amber-300 border-amber-500/30 rounded-xl text-xs font-bold"
                title="Resume in Terminal"
              >
                <Terminal className="w-4 h-4" aria-hidden="true" /> Resume
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={close}
                className="rounded-full bg-white/5 hover:bg-white/20 dark:hover:bg-white/20 text-stone-300 hover:text-white"
                aria-label="Close session"
              >
                <X className="w-5 h-5" aria-hidden="true" />
              </Button>
            </div>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-xs font-semibold text-stone-400 uppercase tracking-widest cursor-pointer hover:text-white transition-colors">
                <input
                  type="checkbox"
                  checked={hideToolCalls}
                  onChange={(e) => toggleHideToolCalls(e.target.checked)}
                  className="accent-amber-500 w-3.5 h-3.5 cursor-pointer"
                />
                Hide tool calls
              </label>
            </div>
          </div>
        </div>

        {/* Messages */}
        <section aria-label="Conversation" className="flex-1 overflow-y-auto p-6 md:p-8 custom-scrollbar">
          <div className="flex flex-col gap-6 max-w-4xl mx-auto">
            {sessionDetail && (
              sessionDetail.items.filter(m => hideToolCalls ? m.role !== "toolResult" : true).length === 0 ? (
                <div className="flex items-center justify-center h-full text-stone-500">
                  <div className="text-center space-y-3">
                    <Terminal className="w-12 h-12 mx-auto text-stone-700 opacity-50" aria-hidden="true" />
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
        </section>

        {/* Chat Input */}
        <div className="p-4 md:p-6 bg-stone-900/80 backdrop-blur-xl border-t border-white/10 shrink-0">
          {isThinking && (
            <div className="mb-3 flex items-center justify-between text-xs text-amber-400 font-mono" role="status">
              <span className="flex items-center gap-2"><RefreshCw className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> Pi is thinking...</span>
            </div>
          )}
          {isCompacting && (
            <div className="mb-3 flex items-center gap-2 text-xs text-amber-400 font-mono" role="status">
              <Archive className="w-3.5 h-3.5 animate-pulse" aria-hidden="true" /> Compacting session…
            </div>
          )}
          {sessionGone && (
            <div className="mb-3 text-xs text-red-400 font-mono" role="status">
              This session&apos;s file is gone or can no longer be streamed.
            </div>
          )}
          <form onSubmit={handleSendMessage} className="flex gap-3 relative">
            <input
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              disabled={sessionGone}
              placeholder="Send a message to this session..."
              aria-label="Message to send to this session"
              className="flex-1 bg-black/40 border border-white/10 rounded-2xl px-5 py-4 text-stone-200 focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/50 shadow-inner placeholder-stone-500 transition-all disabled:opacity-50"
            />
            <Button
              type="submit"
              disabled={!chatInput.trim() || isThinking || sessionGone}
              className="h-auto px-6 bg-amber-600 hover:bg-amber-500 text-white rounded-2xl font-bold shadow-lg"
            >
              Send
            </Button>
          </form>
        </div>
      </div>

      {sessionDetail && (
        <ModelDialog
          open={pickingModel}
          onOpenChange={setPickingModel}
          scope="session"
          file={sessionDetail.file}
          current={sessionDetail.model}
        />
      )}

      <Dialog open={compactOpen} onOpenChange={setCompactOpen}>
        <DialogContent className="border border-white/10 bg-stone-950/95 text-stone-200 backdrop-blur-2xl sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Archive className="h-4 w-4 text-amber-400" aria-hidden="true" />
              Compact this session?
            </DialogTitle>
            <DialogDescription>
              pi summarizes the older context into a compaction entry — exactly
              what /compact does in the terminal. This can take a minute and
              uses the session&apos;s model.
            </DialogDescription>
          </DialogHeader>
          <label className="block">
            <span className="text-[10px] font-bold uppercase tracking-widest text-stone-500">
              Instructions (optional)
            </span>
            <textarea
              value={compactInstructions}
              onChange={(e) => setCompactInstructions(e.target.value)}
              placeholder="e.g. keep every file path we touched"
              className="custom-scrollbar min-h-20 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-stone-200 placeholder-stone-500 focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/50 focus:outline-none"
            />
          </label>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            <Button
              onClick={handleCompact}
              disabled={isCompacting}
              className="bg-amber-600 text-white hover:bg-amber-500"
            >
              <Archive className="w-4 h-4" aria-hidden="true" /> Compact
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
