"use client";

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Terminal, Folder, X, Pencil, Check, ChevronDown, ChevronUp, RefreshCw, Cpu, GitFork, FileDown, Archive, ListTree, Search, Share2 } from "lucide-react";
import { Message, MessagePart, PiState, SessionDetail, SessionModel } from "@/types";
import { fetchJson, formatCost, formatTokens, localDateKey, messageOf } from "@/lib/utils";
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
import { useFocusTrap } from "@/lib/useFocusTrap";
import { SessionTreeDialog, ShareSessionDialog } from "@/components/SessionDialogs";
import {
  BashExecutionBlock,
  ImagePart,
  Markdown,
  ThinkingBlock,
  ToolCallBlock,
} from "@/components/MessageParts";

/** The slash commands this chat input handles itself, for autocomplete. */
const LOCAL_COMMANDS = [
  { cmd: "/fork", desc: "Copy the whole session and continue in the copy" },
  { cmd: "/clone", desc: "Copy only the active branch into a new session" },
  { cmd: "/tree", desc: "Show the session tree" },
  { cmd: "/share", desc: "Share as a secret gist" },
  { cmd: "/export", desc: "Download as HTML" },
  { cmd: "/compact", args: "[instructions]", desc: "Summarize older context" },
  { cmd: "/model", desc: "Change the session model" },
  { cmd: "/name", args: "[new name]", desc: "Rename the session" },
  { cmd: "/new", desc: "Start a new session in this folder" },
  { cmd: "/quit", desc: "Close this chat" },
] as const;

type DeltaEvent = {
  type: string;
  contentIndex?: number;
  delta?: string;
  content?: string;
  toolCall?: { id?: string; name?: string; arguments?: Record<string, unknown> };
};

/**
 * Folds one RPC streaming delta into the parts of the live bubble. Indexed
 * by contentIndex; message_end's file entry is authoritative and replaces
 * all of this.
 */
function applyDelta(parts: MessagePart[], event: DeltaEvent): MessagePart[] {
  const next = [...parts];
  const at = event.contentIndex ?? next.length;
  while (next.length <= at) next.push({ type: "text", text: "" });
  const current = next[at];
  switch (event.type) {
    case "text_start":
      next[at] = { type: "text", text: "" };
      break;
    case "text_delta":
      next[at] = {
        type: "text",
        text: (current.type === "text" ? current.text : "") + (event.delta || ""),
      };
      break;
    case "text_end":
      if (typeof event.content === "string")
        next[at] = { type: "text", text: event.content };
      break;
    case "thinking_start":
      next[at] = { type: "thinking", thinking: "" };
      break;
    case "thinking_delta":
      next[at] = {
        type: "thinking",
        thinking:
          (current.type === "thinking" ? current.thinking : "") + (event.delta || ""),
      };
      break;
    case "thinking_end":
      if (typeof event.content === "string")
        next[at] = { type: "thinking", thinking: event.content };
      break;
    case "toolcall_start":
      next[at] = { type: "toolCall" };
      break;
    case "toolcall_end":
      if (event.toolCall) next[at] = { type: "toolCall", ...event.toolCall };
      break;
    // toolcall_delta streams partial JSON arguments; the placeholder stands.
  }
  return next;
}

type AgentState = "idle" | "streaming" | "tool" | "compacting" | "retrying";

/** What /api/rpc/events sends, mapped server-side from pi's event stream. */
type RpcStreamPayload =
  | { kind: "delta"; event: DeltaEvent }
  | { kind: "message_start" }
  | { kind: "message_end" }
  | { kind: "status"; state: AgentState; toolName?: string }
  | { kind: "closed" };

/** What the edit box should hold: the message's first text part. */
const editableTextOf = (m: Message) =>
  m.parts?.find((part) => part.type === "text")?.text ?? m.text;

/** Non-assistant content: plain text parts and images, no markdown. */
function PlainParts({ m }: { m: Message }) {
  if (!m.parts?.length)
    return <>{m.text || "[no text content]"}</>;
  return (
    <>
      {m.parts.map((part, i) =>
        part.type === "text" ? (
          <div key={i} className="whitespace-pre-wrap">{part.text}</div>
        ) : part.type === "image" ? (
          <ImagePart key={i} data={part.data} mimeType={part.mimeType} />
        ) : null,
      )}
    </>
  );
}

function AssistantParts({
  m,
  hideToolCalls,
  resultFor,
}: {
  m: Message;
  hideToolCalls: boolean;
  resultFor: (callId?: string) => Message | undefined;
}) {
  if (!m.parts?.length)
    return m.text ? <Markdown text={m.text} /> : <>[no text content]</>;
  return (
    <>
      {m.parts.map((part, i) =>
        // "Hide tool calls" hides everything a reader skims past: the
        // reasoning and the tool machinery, keeping only prose and images.
        part.type === "thinking" ? (
          hideToolCalls ? null : <ThinkingBlock key={i} thinking={part.thinking} />
        ) : part.type === "text" ? (
          <Markdown key={i} text={part.text} />
        ) : part.type === "toolCall" ? (
          hideToolCalls ? null : (
            <ToolCallBlock key={i} part={part} result={resultFor(part.id)} />
          )
        ) : part.type === "image" ? (
          <ImagePart key={i} data={part.data} mimeType={part.mimeType} />
        ) : null,
      )}
    </>
  );
}

/** Whether a message would still show something once tool noise is hidden. */
const hasReadableContent = (m: Message) =>
  m.parts
    ? m.parts.some(
        (part) =>
          (part.type === "text" && part.text.trim()) || part.type === "image",
      )
    : Boolean(m.text.trim());

/** Everything the in-chat find can match against for one message. */
const findableTextOf = (m: Message) =>
  [
    m.text,
    m.command,
    m.output,
    ...(m.parts || []).map((part) =>
      part.type === "text" ? part.text : part.type === "thinking" ? part.thinking : "",
    ),
  ]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();

function MessageItem({
  m,
  formatDate,
  onEdit,
  hideToolCalls,
  resultFor,
  highlighted,
}: {
  m: Message;
  formatDate: (d?: string) => string;
  onEdit?: (id: string, text: string) => void;
  hideToolCalls: boolean;
  resultFor: (callId?: string) => Message | undefined;
  highlighted?: boolean;
}) {
  const isTool = m.role === "toolResult";
  const [isOpen, setIsOpen] = useState(!isTool);
  const [isEditing, setIsEditing] = useState(false);
  const [editVal, setEditVal] = useState(() => editableTextOf(m));

  const handleSave = () => {
    if (editVal !== editableTextOf(m) && onEdit) {
      onEdit(m.id, editVal);
    }
    setIsEditing(false);
  };

  const toolLabel =
    m.role === "toolResult"
      ? m.toolName || "Tool Result"
      : m.role === "bashExecution"
        ? "bash"
        : m.role;

  return (
    <article
      id={`msg-${m.id}`}
      className={`group/msg p-5 rounded-2xl border backdrop-blur-md transition-all ${
        highlighted ? "ring-2 ring-amber-400/70 " : ""
      }${
        m.role === "user"
          ? "bg-amber-950/40 border-amber-500/30 ml-0 md:ml-12 shadow-[0_4_20px_rgba(59,130,246,0.1)]"
          : m.role === "assistant"
          ? `${
              m.stopReason === "error"
                ? "bg-red-950/20 border-red-500/40"
                : "bg-orange-950/20 border-orange-500/30"
            } mr-0 md:mr-12 shadow-[0_4_20px_rgba(16,185,129,0.05)]`
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
                onClick={(e) => { e.stopPropagation(); setIsEditing(true); setEditVal(editableTextOf(m)); }}
                className="relative z-10 ml-1 opacity-0 group-hover/msg:opacity-100 focus-visible:opacity-100 bg-black/20 hover:bg-black/40 dark:hover:bg-black/40 text-current hover:text-amber-200 rounded-md"
                title="Edit message"
                aria-label="Edit message"
              >
                <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
              </Button>
            )}
          </div>
          <div className="flex items-center gap-3">
            {m.role === "assistant" &&
              (m.stopReason === "error" ||
                m.stopReason === "aborted" ||
                m.stopReason === "length") && (
                <span
                  className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold ${
                    m.stopReason === "error"
                      ? "bg-red-500/20 text-red-300"
                      : "bg-white/10 text-stone-400"
                  }`}
                  title={
                    m.stopReason === "error"
                      ? "This turn ended in an error"
                      : m.stopReason === "aborted"
                        ? "This turn was aborted"
                        : "This turn hit the output length limit"
                  }
                >
                  {m.stopReason === "length" ? "max length" : m.stopReason}
                </span>
              )}
            {m.role === "assistant" && m.usage && (
              <div
                className="text-[10px] text-stone-500 font-mono"
                title={`input ${m.usage.input ?? "?"} · output ${m.usage.output ?? "?"} · cache read ${m.usage.cacheRead ?? 0} · cache write ${m.usage.cacheWrite ?? 0}`}
              >
                {m.usage.input !== undefined || m.usage.output !== undefined
                  ? `${formatTokens(m.usage.input ?? 0)}→${formatTokens(m.usage.output ?? 0)}`
                  : ""}
                {m.usage.cost?.total ? ` · ${formatCost(m.usage.cost.total)}` : ""}
              </div>
            )}
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
      ) : m.role === "bashExecution" ? (
        <BashExecutionBlock m={m} />
      ) : (
        <div
          className={`text-stone-200 text-sm break-words leading-relaxed relative transition-all duration-300 ${
            m.role === "assistant" ? "" : "whitespace-pre-wrap"
          } ${isTool && !isOpen ? "max-h-24 overflow-hidden" : ""}`}
        >
          {m.role === "assistant" ? (
            <AssistantParts m={m} hideToolCalls={hideToolCalls} resultFor={resultFor} />
          ) : (
            <PlainParts m={m} />
          )}
          {m.role === "summary" && m.tokensBefore !== undefined && (
            <div className="mt-1 font-mono text-[10px] not-italic text-stone-500">
              compacted from {formatTokens(m.tokensBefore)} tokens
            </div>
          )}
          {m.role === "assistant" && m.errorMessage && (
            <div className="mt-2 rounded-lg border border-red-500/30 bg-red-950/30 px-3 py-2 font-mono text-xs whitespace-pre-wrap text-red-300">
              {m.errorMessage}
            </div>
          )}
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
  const [treeOpen, setTreeOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [findAt, setFindAt] = useState(0);
  const [cmdAt, setCmdAt] = useState(0);
  const [cmdDismissed, setCmdDismissed] = useState(false);
  const chatInputRef = useRef<HTMLTextAreaElement>(null);
  const chatFormRef = useRef<HTMLFormElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef, chatInputRef);

  const [agentState, setAgentState] = useState<AgentState>("idle");
  const [activeTool, setActiveTool] = useState("");
  /** Parts of the assistant message currently streaming; null when none. */
  const [streamingParts, setStreamingParts] = useState<MessagePart[] | null>(null);
  const agentStateRef = useRef(agentState);
  useEffect(() => {
    agentStateRef.current = agentState;
  }, [agentState]);

  // Model catalog, for the context-window size of the session's model.
  const [piModels, setPiModels] = useState<PiState["models"] | null>(null);

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

  useEffect(() => {
    // Missing state (pi not configured) just hides the context gauge.
    fetchJson<PiState>("/api/pi/state")
      .then((state) => setPiModels(state.models))
      .catch(() => {});
  }, []);

  // Live agent activity from the session's RPC process: token deltas feed
  // the streaming bubble, status events feed the activity line. The file
  // watcher SSE stays the authority on persisted messages.
  useEffect(() => {
    const events = new EventSource(`/api/rpc/events?file=${encodeURIComponent(file)}`);
    events.onmessage = (event) => {
      let payload: RpcStreamPayload;
      try {
        payload = JSON.parse(event.data);
      } catch {
        return;
      }
      if (payload.kind === "status") {
        setAgentState(payload.state);
        setActiveTool(payload.state === "tool" ? payload.toolName || "tool" : "");
        if (payload.state === "idle") setStreamingParts(null);
      } else if (payload.kind === "message_start") {
        setStreamingParts([]);
      } else if (payload.kind === "message_end") {
        setStreamingParts(null);
      } else if (payload.kind === "delta") {
        setStreamingParts((prev) => applyDelta(prev ?? [], payload.event));
      } else if (payload.kind === "closed") {
        setAgentState("idle");
        setStreamingParts(null);
      }
    };
    return () => events.close();
  }, [file]);

  // Closing the chat retires an idle pi process; a mid-run one is left to
  // finish (or idle out) so closing the window never kills a running turn.
  useEffect(
    () => () => {
      if (agentStateRef.current !== "idle") return;
      fetch("/api/rpc/close", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file }),
        keepalive: true,
      }).catch(() => {});
    },
    [file],
  );

  const handleAbort = async () => {
    try {
      await fetchJson("/api/rpc/abort", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file }),
      });
    } catch (err) {
      toast(messageOf(err));
    }
  };

  /**
   * Session-wide accounting from the entries themselves: dollar total across
   * every usage-bearing item, and the context size after the latest
   * assistant turn (what the next request will roughly resend).
   */
  const usageStats = useMemo(() => {
    let cost = 0;
    let contextTokens: number | null = null;
    for (const item of sessionDetail?.items || []) {
      if (item.usage?.cost?.total) cost += item.usage.cost.total;
      if (item.role === "assistant" && item.usage) {
        const u = item.usage;
        const total =
          u.totalTokens ??
          (u.input ?? 0) + (u.output ?? 0) + (u.cacheRead ?? 0) + (u.cacheWrite ?? 0);
        if (total > 0) contextTokens = total;
      }
    }
    return { cost, contextTokens };
  }, [sessionDetail?.items]);

  const contextWindow = useMemo(() => {
    const model = sessionDetail?.model;
    if (!model || !piModels) return null;
    const known = piModels.find(
      (candidate) =>
        candidate.provider === model.provider && candidate.id === model.modelId,
    );
    return known?.contextWindow || null;
  }, [piModels, sessionDetail?.model]);

  const contextPercent =
    usageStats.contextTokens && contextWindow
      ? Math.min(100, Math.round((usageStats.contextTokens / contextWindow) * 100))
      : null;

  const itemCount = sessionDetail?.items.length ?? 0;
  useEffect(() => {
    if (itemCount > 0) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [itemCount]);

  // Deltas land many times a second; keep the live bubble in view without
  // the smooth-scroll animation stacking up.
  useEffect(() => {
    if (streamingParts !== null)
      messagesEndRef.current?.scrollIntoView({ block: "end" });
  }, [streamingParts]);

  // Escape closes the find bar first, then the dialog (matching the
  // backdrop click); Ctrl/Cmd+F opens in-conversation find.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setFindOpen(true);
        return;
      }
      if (e.key === "Escape") {
        if (findOpen) setFindOpen(false);
        else close();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [close, findOpen]);

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

  /** Jump into a session file that was just created from this one. */
  const openDerivedSession = (file: string) => {
    const params = new URLSearchParams(window.location.search);
    if (sessionDetail?.cwd) params.set("location", sessionDetail.cwd);
    params.set("session", file);
    const today = localDateKey(new Date());
    router.push(`/${encodeURIComponent(today)}?${params.toString()}`);
  };

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
      openDerivedSession(data.file);
    } catch (err) {
      toast(messageOf(err));
    }
  };

  /** The /clone counterpart: only the active branch survives into the copy. */
  const handleClone = async () => {
    if (!sessionDetail) return;
    try {
      const data = await fetchJson<{ file: string }>("/api/session/clone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file: sessionDetail.file }),
      });
      toast("Cloned the active branch into a new session.");
      openDerivedSession(data.file);
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
    // isThinking guards only the legacy one-shot path; the RPC path queues
    // a prompt sent mid-run as a follow-up instead of refusing it.
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
    if (message === "/clone") {
      handleClone();
      return;
    }
    if (message === "/tree") {
      setTreeOpen(true);
      return;
    }
    if (message === "/share") {
      setShareOpen(true);
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

    // RPC first: prompts stream and can be aborted or queued. The one-shot
    // `pi -p` path stays as the fallback for a pi without RPC mode.
    try {
      const data = await fetchJson<{ queued: boolean }>("/api/rpc/prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file: sessionDetail.file, message }),
      });
      if (data.queued)
        toast("Queued — pi picks it up when the current run settles.");
      return;
    } catch (err) {
      console.warn("RPC prompt failed, falling back to one-shot pi:", err);
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

  /**
   * Tool results render inline under the assistant tool call that produced
   * them (matched by toolCallId); only orphaned results — the call side is
   * missing or was compacted away — keep their own card.
   */
  const { resultsByCallId, pairedResultIds } = useMemo(() => {
    const resultsByCallId = new Map<string, Message>();
    const pairedResultIds = new Set<string>();
    const items = sessionDetail?.items || [];
    const callIds = new Set<string>();
    for (const item of items)
      for (const part of item.parts || [])
        if (part.type === "toolCall" && part.id) callIds.add(part.id);
    for (const item of items)
      if (item.role === "toolResult" && item.toolCallId) {
        resultsByCallId.set(item.toolCallId, item);
        if (callIds.has(item.toolCallId)) pairedResultIds.add(item.id);
      }
    return { resultsByCallId, pairedResultIds };
  }, [sessionDetail?.items]);

  const resultFor = useCallback(
    (callId?: string) => (callId ? resultsByCallId.get(callId) : undefined),
    [resultsByCallId],
  );

  const visibleItems = useMemo(
    () =>
      (sessionDetail?.items || []).filter((m) => {
        if (m.role === "toolResult")
          return !pairedResultIds.has(m.id) && !hideToolCalls;
        // With tool noise hidden, an assistant turn that only called tools
        // or only thought would render as an empty shell — drop it whole.
        if (hideToolCalls && m.role === "assistant")
          return hasReadableContent(m) || Boolean(m.errorMessage);
        return true;
      }),
    [sessionDetail?.items, pairedResultIds, hideToolCalls],
  );

  const matchIds = useMemo(() => {
    const needle = findQuery.trim().toLowerCase();
    if (!findOpen || !needle) return [];
    return visibleItems
      .filter((m) => findableTextOf(m).includes(needle))
      .map((m) => m.id);
  }, [findOpen, findQuery, visibleItems]);

  // The stored position may outlive a shrinking match list; clamp at render.
  const matchAt = matchIds.length ? Math.min(findAt, matchIds.length - 1) : 0;
  const currentMatchId = matchIds[matchAt];

  useEffect(() => {
    if (currentMatchId)
      document
        .getElementById(`msg-${currentMatchId}`)
        ?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [currentMatchId]);

  const stepFind = (delta: number) => {
    if (!matchIds.length) return;
    setFindAt((matchAt + delta + matchIds.length) % matchIds.length);
  };

  // Slash-command autocomplete: live while the input is a single "/word".
  const cmdSuggestions = useMemo(() => {
    if (cmdDismissed) return [];
    const value = chatInput;
    if (!value.startsWith("/") || /[\s\n]/.test(value)) return [];
    return LOCAL_COMMANDS.filter((c) => c.cmd.startsWith(value));
  }, [chatInput, cmdDismissed]);
  const cmdIndex = Math.min(cmdAt, Math.max(0, cmdSuggestions.length - 1));

  /** Complete to the highlighted command; arg commands get a ready space. */
  const completeCommand = () => {
    const suggestion = cmdSuggestions[cmdIndex];
    if (!suggestion) return;
    setChatInput(suggestion.cmd + ("args" in suggestion && suggestion.args ? " " : ""));
    setCmdAt(0);
  };

  // The textarea grows with its content, up to a few lines.
  useEffect(() => {
    const el = chatInputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [chatInput]);

  const onChatInputKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (cmdSuggestions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setCmdAt(Math.min(cmdIndex + 1, cmdSuggestions.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setCmdAt(Math.max(cmdIndex - 1, 0));
        return;
      }
      if (e.key === "Tab") {
        e.preventDefault();
        completeCommand();
        return;
      }
      if (e.key === "Escape") {
        // Dismiss the menu only — not the whole modal.
        e.stopPropagation();
        setCmdDismissed(true);
        return;
      }
      if (
        e.key === "Enter" &&
        !e.shiftKey &&
        cmdSuggestions[cmdIndex]?.cmd !== chatInput.trim()
      ) {
        e.preventDefault();
        completeCommand();
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      chatFormRef.current?.requestSubmit();
    }
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
        ref={panelRef}
        tabIndex={-1}
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
              {(usageStats.cost > 0 || usageStats.contextTokens !== null) && (
                <div className="flex items-center gap-3 text-[11px] text-stone-500">
                  {usageStats.cost > 0 && (
                    <span title="Total cost recorded in this session">
                      {formatCost(usageStats.cost)}
                    </span>
                  )}
                  {usageStats.contextTokens !== null && (
                    <span
                      title={
                        contextWindow
                          ? `Context after the last turn: ${usageStats.contextTokens.toLocaleString()} of ${contextWindow.toLocaleString()} tokens`
                          : `Context after the last turn: ${usageStats.contextTokens.toLocaleString()} tokens`
                      }
                      className="flex items-center gap-1.5"
                    >
                      {formatTokens(usageStats.contextTokens)} ctx
                      {contextPercent !== null && (
                        <>
                          <span
                            className="inline-block h-1 w-14 overflow-hidden rounded-full bg-white/10"
                            aria-hidden="true"
                          >
                            <span
                              className={`block h-full rounded-full ${
                                contextPercent >= 80 ? "bg-red-400/80" : "bg-amber-400/70"
                              }`}
                              style={{ width: `${contextPercent}%` }}
                            />
                          </span>
                          <span className={contextPercent >= 80 ? "text-red-400" : ""}>
                            {contextPercent}%
                          </span>
                        </>
                      )}
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-col items-end gap-4 shrink-0">
            <div className="flex items-center gap-2 self-end">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setTreeOpen(true)}
                disabled={!sessionDetail || sessionGone}
                className="rounded-full bg-white/5 hover:bg-white/20 dark:hover:bg-white/20 text-stone-300 hover:text-white"
                title="Session tree (/tree)"
                aria-label="Show session tree"
              >
                <ListTree className="w-4 h-4" aria-hidden="true" />
              </Button>
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
                onClick={() => setShareOpen(true)}
                disabled={!sessionDetail || sessionGone}
                className="rounded-full bg-white/5 hover:bg-white/20 dark:hover:bg-white/20 text-stone-300 hover:text-white"
                title="Share as secret gist (/share)"
                aria-label="Share session"
              >
                <Share2 className="w-4 h-4" aria-hidden="true" />
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
              <label
                title="Hide tool calls, tool results, thinking, and turns that contain nothing else"
                className="flex items-center gap-2 text-xs font-semibold text-stone-400 uppercase tracking-widest cursor-pointer hover:text-white transition-colors"
              >
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
          {findOpen && (
            <div className="sticky -top-4 md:-top-6 z-20 mx-auto mb-4 flex max-w-md items-center gap-2 rounded-2xl border border-white/10 bg-stone-950/95 px-3 py-2 shadow-xl backdrop-blur-xl">
              <Search className="h-3.5 w-3.5 shrink-0 text-stone-500" aria-hidden="true" />
              <input
                autoFocus
                value={findQuery}
                onChange={(e) => {
                  setFindQuery(e.target.value);
                  setFindAt(0);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    stepFind(e.shiftKey ? -1 : 1);
                  }
                }}
                placeholder="Find in conversation…"
                aria-label="Find in conversation"
                className="w-full bg-transparent text-sm text-stone-200 placeholder-stone-500 focus:outline-none"
              />
              <span className="shrink-0 font-mono text-[10px] text-stone-500" aria-live="polite">
                {findQuery.trim() ? (matchIds.length ? `${matchAt + 1}/${matchIds.length}` : "0/0") : ""}
              </span>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => stepFind(-1)}
                disabled={!matchIds.length}
                className="rounded-md bg-white/5 text-stone-400 hover:bg-white/10 dark:hover:bg-white/10 hover:text-white"
                aria-label="Previous match"
              >
                <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => stepFind(1)}
                disabled={!matchIds.length}
                className="rounded-md bg-white/5 text-stone-400 hover:bg-white/10 dark:hover:bg-white/10 hover:text-white"
                aria-label="Next match"
              >
                <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => setFindOpen(false)}
                className="rounded-md bg-white/5 text-stone-400 hover:bg-white/10 dark:hover:bg-white/10 hover:text-white"
                aria-label="Close find"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
            </div>
          )}
          <div className="flex flex-col gap-6 max-w-4xl mx-auto">
            {sessionDetail && (
              visibleItems.length === 0 ? (
                <div className="flex items-center justify-center h-full text-stone-500">
                  <div className="text-center space-y-3">
                    <Terminal className="w-12 h-12 mx-auto text-stone-700 opacity-50" aria-hidden="true" />
                    <p className="tracking-widest uppercase text-xs font-semibold">Void</p>
                  </div>
                </div>
              ) : (
                visibleItems.map((m) => (
                  <MessageItem
                    key={m.id}
                    m={m}
                    formatDate={formatDate}
                    onEdit={handleEditMessage}
                    hideToolCalls={hideToolCalls}
                    resultFor={resultFor}
                    highlighted={m.id === currentMatchId}
                  />
                ))
              )
            )}
            {streamingParts !== null && (
              <article
                aria-live="polite"
                className="p-5 rounded-2xl border backdrop-blur-md bg-orange-950/20 border-orange-500/30 mr-0 md:mr-12"
              >
                <div className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-orange-400">
                  assistant
                  <RefreshCw className="h-3 w-3 animate-spin" aria-hidden="true" />
                </div>
                <div className="text-stone-200 text-sm break-words leading-relaxed">
                  {streamingParts.length > 0 ? (
                    <AssistantParts
                      m={{
                        id: "__streaming__",
                        role: "assistant",
                        text: "",
                        parts: streamingParts,
                      }}
                      hideToolCalls={hideToolCalls}
                      resultFor={() => undefined}
                    />
                  ) : (
                    <span className="animate-pulse text-stone-500">…</span>
                  )}
                </div>
              </article>
            )}
            <div ref={messagesEndRef} className="h-4" />
          </div>
        </section>

        {/* Chat Input */}
        <div className="p-4 md:p-6 bg-stone-900/80 backdrop-blur-xl border-t border-white/10 shrink-0">
          {(isThinking || agentState !== "idle") && (
            <div className="mb-3 flex items-center justify-between text-xs text-amber-400 font-mono" role="status">
              <span className="flex items-center gap-2">
                <RefreshCw className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                {agentState === "tool"
                  ? `Running ${activeTool}…`
                  : agentState === "compacting"
                    ? "Compacting…"
                    : agentState === "retrying"
                      ? "Retrying after a transient error…"
                      : "Pi is thinking..."}
              </span>
              {agentState !== "idle" && (
                <Button
                  variant="ghost"
                  onClick={handleAbort}
                  className="h-auto gap-1.5 rounded-lg bg-red-500/15 px-3 py-1 text-[11px] font-bold text-red-300 hover:bg-red-500/25 dark:hover:bg-red-500/25 hover:text-red-200"
                  title="Abort the current run (/abort)"
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" /> Stop
                </Button>
              )}
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
          <form ref={chatFormRef} onSubmit={handleSendMessage} className="flex gap-3 relative">
            {cmdSuggestions.length > 0 && (
              <div className="absolute bottom-full left-0 right-0 z-10 mb-2 overflow-hidden rounded-2xl border border-white/10 bg-stone-950/95 shadow-xl backdrop-blur-xl">
                <ul role="listbox" aria-label="Slash commands">
                  {cmdSuggestions.map((suggestion, index) => (
                    <li key={suggestion.cmd} role="option" aria-selected={index === cmdIndex}>
                      <button
                        type="button"
                        onClick={() => {
                          setCmdAt(index);
                          setChatInput(
                            suggestion.cmd +
                              ("args" in suggestion && suggestion.args ? " " : ""),
                          );
                          chatInputRef.current?.focus();
                        }}
                        onMouseMove={() => setCmdAt(index)}
                        className={`flex w-full items-baseline gap-3 px-4 py-2 text-left text-sm ${
                          index === cmdIndex
                            ? "bg-amber-500/15 text-white"
                            : "text-stone-300 hover:bg-white/5"
                        }`}
                      >
                        <span className="font-mono font-bold">
                          {suggestion.cmd}
                          {"args" in suggestion && suggestion.args ? (
                            <span className="ml-1 font-normal text-stone-500">
                              {suggestion.args}
                            </span>
                          ) : null}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-xs text-stone-500">
                          {suggestion.desc}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
                <div className="border-t border-white/10 px-4 py-1.5 font-mono text-[10px] text-stone-600">
                  tab complete · ↵ run · esc dismiss
                </div>
              </div>
            )}
            <textarea
              ref={chatInputRef}
              rows={1}
              value={chatInput}
              onChange={(e) => {
                setChatInput(e.target.value);
                setCmdDismissed(false);
              }}
              onKeyDown={onChatInputKeyDown}
              disabled={sessionGone}
              placeholder="Send a message… ( / for commands, Shift+Enter for a new line )"
              aria-label="Message to send to this session"
              className="custom-scrollbar flex-1 resize-none bg-black/40 border border-white/10 rounded-2xl px-5 py-4 text-stone-200 focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/50 shadow-inner placeholder-stone-500 transition-all disabled:opacity-50"
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
      {sessionDetail && (
        <SessionTreeDialog
          open={treeOpen}
          onOpenChange={setTreeOpen}
          file={sessionDetail.file}
          onBranched={openDerivedSession}
        />
      )}
      {sessionDetail && (
        <ShareSessionDialog
          open={shareOpen}
          onOpenChange={setShareOpen}
          file={sessionDetail.file}
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
