"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import {
  Brain,
  ChevronDown,
  ChevronRight,
  SquareTerminal,
  Wrench,
} from "lucide-react";
import type { Message, MessagePart } from "@/types";

/** Assistant prose: GFM markdown with highlighted fenced code blocks. */
export function Markdown({ text }: { text: string }) {
  return (
    <div className="chat-markdown text-sm leading-relaxed break-words text-stone-200">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
        {text}
      </ReactMarkdown>
    </div>
  );
}

export function ImagePart({ data, mimeType }: { data: string; mimeType?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- data URI, not an asset
    <img
      src={`data:${mimeType || "image/png"};base64,${data}`}
      alt="Message attachment"
      className="my-2 max-h-80 max-w-full rounded-xl border border-white/10"
    />
  );
}

/**
 * Reasoning content, collapsed by default. Anthropic and kimi store the full
 * visible reasoning; openai-codex stores only a summary headline — either
 * way, what pi kept is what shows.
 */
export function ThinkingBlock({ thinking }: { thinking: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="my-2 rounded-xl border border-white/10 bg-black/20">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-[11px] font-bold uppercase tracking-widest text-stone-500 transition-colors hover:text-stone-300"
      >
        {open ? (
          <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
        )}
        <Brain className="h-3.5 w-3.5" aria-hidden="true" />
        Thinking
      </button>
      {open && (
        <div className="px-4 pb-3 text-sm italic leading-relaxed whitespace-pre-wrap break-words text-stone-400">
          {thinking}
        </div>
      )}
    </div>
  );
}

/** +/- colored lines for pi's precomputed edit diffs and unified patches. */
function DiffBlock({ diff }: { diff: string }) {
  return (
    <pre className="custom-scrollbar my-2 max-h-80 overflow-auto rounded-xl border border-white/10 bg-black/40 p-3 font-mono text-xs leading-relaxed">
      {diff.replace(/\n$/, "").split("\n").map((line, i) => (
        <div
          key={i}
          className={
            line.startsWith("+")
              ? "bg-emerald-500/10 text-emerald-300"
              : line.startsWith("-")
                ? "bg-red-500/10 text-red-300"
                : line.startsWith("@@")
                  ? "text-stone-500"
                  : "text-stone-300"
          }
        >
          {line || " "}
        </div>
      ))}
    </pre>
  );
}

function CodeBlock({ text }: { text: string }) {
  return (
    <pre className="custom-scrollbar my-2 max-h-80 overflow-auto rounded-xl border border-white/10 bg-black/40 p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words text-stone-300">
      {text}
    </pre>
  );
}

type ToolCallPart = Extract<MessagePart, { type: "toolCall" }>;

/** The one argument worth showing beside a tool's name. */
function argSummary(args: Record<string, unknown>) {
  for (const key of ["path", "command", "pattern", "url"]) {
    if (typeof args[key] === "string") return args[key] as string;
  }
  const first = Object.values(args).find((value) => typeof value === "string");
  return typeof first === "string" ? first : "";
}

/** The edit tool result carries a display diff pi already computed. */
function diffFromDetails(details: unknown) {
  if (!details || typeof details !== "object") return null;
  const { diff, patch } = details as { diff?: unknown; patch?: unknown };
  if (typeof diff === "string" && diff.trim()) return diff;
  if (typeof patch === "string" && patch.trim()) return patch;
  return null;
}

/** Fallback while an edit has no result yet: its oldText/newText pairs. */
function diffFromEditArgs(args: Record<string, unknown>) {
  if (!Array.isArray(args.edits)) return null;
  const lines: string[] = [];
  for (const edit of args.edits as { oldText?: unknown; newText?: unknown }[]) {
    if (typeof edit?.oldText === "string")
      lines.push(...edit.oldText.replace(/\n$/, "").split("\n").map((l) => `-${l}`));
    if (typeof edit?.newText === "string")
      lines.push(...edit.newText.replace(/\n$/, "").split("\n").map((l) => `+${l}`));
    lines.push("");
  }
  return lines.length ? lines.join("\n").trim() : null;
}

function resultText(result: Message) {
  if (result.parts?.length)
    return result.parts
      .map((part) => (part.type === "text" ? part.text : ""))
      .filter(Boolean)
      .join("\n");
  return result.text;
}

/**
 * A tool call from an assistant message, paired with its result when one has
 * arrived. The "hide tool calls" toggle removes these entirely.
 */
export function ToolCallBlock({
  part,
  result,
}: {
  part: ToolCallPart;
  result?: Message;
}) {
  const [open, setOpen] = useState(false);
  const name = part.name || "tool";
  const args = part.arguments || {};
  const summary = argSummary(args);
  const failed = result?.isError === true;

  const header = (
    <>
      <Wrench className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="shrink-0 font-bold">{name}</span>
      {summary && (
        <span className="truncate font-mono normal-case tracking-normal text-stone-500">
          {summary}
        </span>
      )}
      {failed && (
        <span className="ml-auto shrink-0 rounded-md bg-red-500/20 px-1.5 py-0.5 text-[10px] font-bold text-red-300">
          failed
        </span>
      )}
      {!result && (
        <span className="ml-auto shrink-0 text-[10px] text-stone-600">running…</span>
      )}
    </>
  );

  const diff =
    name === "edit"
      ? (diffFromDetails(result?.details) ?? diffFromEditArgs(args))
      : null;
  const output = result ? resultText(result) : "";
  const images = result?.parts?.filter((p) => p.type === "image") || [];

  return (
    <div
      className={`my-2 rounded-xl border ${
        failed ? "border-red-500/30 bg-red-950/20" : "border-white/10 bg-black/20"
      }`}
    >
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-label={`${open ? "Collapse" : "Expand"} ${name} tool call`}
        className={`flex w-full min-w-0 items-center gap-2 px-3 py-2 text-[11px] uppercase tracking-widest transition-colors ${
          failed ? "text-red-300 hover:text-red-200" : "text-stone-400 hover:text-stone-200"
        }`}
      >
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        )}
        {header}
      </button>
      {open && (
        <div className="px-3 pb-3">
          {name === "edit" && diff ? (
            <DiffBlock diff={diff} />
          ) : name === "write" && typeof args.content === "string" ? (
            <CodeBlock text={args.content} />
          ) : name === "bash" && typeof args.command === "string" ? (
            <CodeBlock text={`$ ${args.command}`} />
          ) : Object.keys(args).length > 0 ? (
            <CodeBlock text={JSON.stringify(args, null, 2)} />
          ) : null}
          {result && (
            <div className="mt-1">
              <div className="mb-1 text-[10px] font-bold uppercase tracking-widest text-stone-600">
                Result
              </div>
              {output ? (
                <pre
                  className={`custom-scrollbar max-h-80 overflow-auto rounded-xl border border-white/10 bg-black/40 p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words ${
                    failed ? "text-red-200" : "text-stone-300"
                  }`}
                >
                  {output}
                </pre>
              ) : images.length === 0 ? (
                <div className="text-xs text-stone-600">[no output]</div>
              ) : null}
              {images.map((image, i) =>
                image.type === "image" ? (
                  <ImagePart key={i} data={image.data} mimeType={image.mimeType} />
                ) : null,
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** A `!command` the user ran from pi's prompt: command, output, exit code. */
export function BashExecutionBlock({ m }: { m: Message }) {
  const exit = m.cancelled ? "cancelled" : m.exitCode;
  const failed = m.cancelled || (typeof m.exitCode === "number" && m.exitCode !== 0);
  return (
    <div className="rounded-xl border border-white/10 bg-black/30">
      <div className="flex min-w-0 items-center gap-2 px-3 py-2 text-xs text-stone-400">
        <SquareTerminal className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <code className="truncate font-mono text-stone-200">$ {m.command}</code>
        {exit !== undefined && exit !== null && (
          <span
            className={`ml-auto shrink-0 rounded-md px-1.5 py-0.5 font-mono text-[10px] font-bold ${
              failed ? "bg-red-500/20 text-red-300" : "bg-white/5 text-stone-500"
            }`}
          >
            {typeof exit === "number" ? `exit ${exit}` : exit}
          </span>
        )}
      </div>
      {m.output && (
        <pre className="custom-scrollbar max-h-64 overflow-auto border-t border-white/5 p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words text-stone-300">
          {m.output}
          {m.truncated ? "\n[output truncated]" : ""}
        </pre>
      )}
    </div>
  );
}
