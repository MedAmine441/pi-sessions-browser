"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  Check,
  Copy,
  GitBranchPlus,
  GitFork,
  ListTree,
  Share2,
} from "lucide-react";
import { SessionTree, SessionTreeNode } from "@/types";
import { fetchJson, messageOf } from "@/lib/utils";
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

const dialogClasses =
  "border border-white/10 bg-stone-950/95 text-stone-200 backdrop-blur-2xl sm:max-w-lg";

const roleColors: Record<string, string> = {
  user: "text-amber-300",
  assistant: "text-orange-300",
  summary: "text-stone-400 italic",
  toolResult: "text-stone-500",
};

/**
 * The /tree counterpart: the session's id/parentId tree with pi's active
 * path (the ancestry of the file's last entry) highlighted, and pi's
 * fork-from-entry as the per-node action. Cloning the active branch lives
 * here too — it's the tree's most natural verb.
 */
export function SessionTreeDialog({
  open,
  onOpenChange,
  file,
  onBranched,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  file: string;
  onBranched: (file: string) => void;
}) {
  const [tree, setTree] = useState<SessionTree | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [showTools, setShowTools] = useState(false);

  // Blank stale content the moment the dialog reopens — during render.
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) {
      setTree(null);
      setError("");
    }
  }

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetchJson<SessionTree>(
      `/api/session/tree?file=${encodeURIComponent(file)}`,
    )
      .then((data) => !cancelled && setTree(data))
      .catch((err) => !cancelled && setError(messageOf(err)));
    return () => {
      cancelled = true;
    };
  }, [open, file]);

  const branchFrom = async (entryId?: string) => {
    setBusy(entryId ?? "leaf");
    try {
      const url = entryId ? "/api/session/fork" : "/api/session/clone";
      const data = await fetchJson<{ file: string }>(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file, entryId }),
      });
      toast(
        entryId
          ? "Forked from that point — you are now in the new branch."
          : "Cloned the active branch into a new session.",
      );
      onOpenChange(false);
      onBranched(data.file);
    } catch (err) {
      toast(messageOf(err));
    } finally {
      setBusy(null);
    }
  };

  /** Children in file order; hidden roles render their children in place. */
  const childrenOf = new Map<string | null, SessionTreeNode[]>();
  for (const node of tree?.nodes ?? []) {
    const known = tree!.nodes.some((n) => n.id === node.parentId);
    const key = known ? node.parentId : null;
    childrenOf.set(key, [...(childrenOf.get(key) ?? []), node]);
  }

  const renderNodes = (parent: string | null, depth: number): ReactNode =>
    (childrenOf.get(parent) ?? []).map((node) => {
      const hidden = !showTools && node.role === "toolResult";
      const isLeaf = node.id === tree?.leafId;
      return (
        <div key={node.id}>
          {!hidden && (
            <div
              style={{ marginLeft: depth * 14 }}
              className={`group flex items-center gap-2 rounded-lg border-l-2 py-1 pr-1 pl-2 ${
                node.active
                  ? "border-amber-500/60 bg-amber-500/5"
                  : "border-white/10"
              }`}
            >
              <span
                className={`shrink-0 text-[9px] font-bold uppercase tracking-wider ${roleColors[node.role] ?? "text-stone-400"}`}
              >
                {node.role === "toolResult" ? node.toolName || "tool" : node.role}
              </span>
              <span className="min-w-0 flex-1 truncate text-xs text-stone-300">
                {node.text || "[no text]"}
              </span>
              {isLeaf && (
                <span className="shrink-0 rounded-md bg-amber-500/20 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-300">
                  current
                </span>
              )}
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => branchFrom(node.id)}
                disabled={busy !== null}
                className="shrink-0 rounded-md bg-black/20 text-stone-400 opacity-0 hover:bg-amber-500/20 hover:text-amber-300 focus-visible:opacity-100 group-hover:opacity-100 dark:hover:bg-amber-500/20"
                title="Fork a new session from this point"
                aria-label={`Fork from this ${node.role} entry`}
              >
                <GitFork className="h-3 w-3" aria-hidden="true" />
              </Button>
            </div>
          )}
          {renderNodes(node.id, hidden ? depth : depth + 1)}
        </div>
      );
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={dialogClasses}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ListTree className="h-4 w-4 text-amber-400" aria-hidden="true" />
            Session tree
          </DialogTitle>
          <DialogDescription>
            Every branch in this session; the highlighted path is what pi
            continues from. Fork from any entry to explore an alternative.
          </DialogDescription>
        </DialogHeader>

        <label className="flex w-fit cursor-pointer items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-stone-500 hover:text-stone-300">
          <input
            type="checkbox"
            checked={showTools}
            onChange={(e) => setShowTools(e.target.checked)}
            className="h-3 w-3 cursor-pointer accent-amber-500"
          />
          Show tool results
        </label>

        <div className="custom-scrollbar max-h-80 space-y-0.5 overflow-y-auto pr-1">
          {error ? (
            <p className="py-6 text-center text-sm text-red-400">{error}</p>
          ) : !tree ? (
            <p className="animate-pulse py-6 text-center font-mono text-sm text-stone-500">
              Reading tree…
            </p>
          ) : tree.nodes.length === 0 ? (
            <p className="py-6 text-center text-sm text-stone-500">
              Nothing here yet.
            </p>
          ) : (
            renderNodes(null, 0)
          )}
        </div>

        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Close</DialogClose>
          <Button
            onClick={() => branchFrom(undefined)}
            disabled={busy !== null || !tree || tree.nodes.length === 0}
            className="bg-amber-600 text-white hover:bg-amber-500"
            title="Duplicate the highlighted branch into a new session (/clone)"
          >
            <GitBranchPlus className="h-4 w-4" aria-hidden="true" /> Clone active
            branch
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The /share counterpart: pi's HTML export uploaded as a secret gist via the
 * gh CLI, answered with the same viewer link the terminal prints.
 */
export function ShareSessionDialog({
  open,
  onOpenChange,
  file,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  file: string;
}) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ gistUrl: string; viewerUrl: string } | null>(null);
  const [copied, setCopied] = useState("");

  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) {
      setResult(null);
      setCopied("");
    }
  }

  const share = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const data = await fetchJson<{ gistUrl: string; viewerUrl: string }>(
        "/api/session/share",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ file }),
        },
      );
      setResult(data);
    } catch (err) {
      toast(messageOf(err));
    } finally {
      setBusy(false);
    }
  };

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(url);
    } catch {
      toast("Could not copy — the link is shown below.");
    }
  };

  const linkRow = (label: string, url: string) => (
    <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-bold uppercase tracking-widest text-stone-500">
          {label}
        </p>
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="block truncate font-mono text-xs text-amber-300 hover:underline"
        >
          {url}
        </a>
      </div>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => copy(url)}
        className="shrink-0 rounded-lg text-stone-400 hover:bg-white/10 hover:text-white dark:hover:bg-white/10"
        aria-label={`Copy ${label} link`}
      >
        {copied === url ? (
          <Check className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
        ) : (
          <Copy className="h-3.5 w-3.5" aria-hidden="true" />
        )}
      </Button>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={dialogClasses}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Share2 className="h-4 w-4 text-amber-400" aria-hidden="true" />
            Share session
          </DialogTitle>
          <DialogDescription>
            Uploads pi&apos;s HTML export as a <strong>secret gist</strong> on
            your GitHub account (via the gh CLI) and gives you a viewer link —
            exactly what /share does in the terminal. Anyone with the link can
            read the whole conversation.
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="space-y-2">
            {linkRow("Share link", result.viewerUrl)}
            {linkRow("Gist", result.gistUrl)}
          </div>
        ) : (
          busy && (
            <p className="animate-pulse text-center font-mono text-xs text-stone-500">
              Exporting and uploading…
            </p>
          )
        )}

        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>
            {result ? "Done" : "Cancel"}
          </DialogClose>
          {!result && (
            <Button
              onClick={share}
              disabled={busy}
              className="bg-amber-600 text-white hover:bg-amber-500"
            >
              <Share2 className="h-4 w-4" aria-hidden="true" />
              {busy ? "Sharing…" : "Create secret gist"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
