"use client";

import { useEffect, useRef, useState } from "react";
import { CornerLeftUp, Folder, FolderOpen, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fetchJson, messageOf, shortenPath } from "@/lib/utils";
import { useFocusTrap } from "@/lib/useFocusTrap";

type Listing = {
  path: string;
  parent: string | null;
  directories: string[];
};

export default function FolderPicker({
  onCancel,
  onSelect,
}: {
  onCancel: () => void;
  onSelect: (path: string) => void;
}) {
  const [listing, setListing] = useState<Listing | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef);
  // Empty means "wherever the server starts you", which is the home folder.
  const [path, setPath] = useState("");
  const [error, setError] = useState("");
  const [showHidden, setShowHidden] = useState(false);
  // Only the very first listing has nothing to show; while navigating, the
  // previous folder stays visible until the next one arrives.
  const loading = !listing && !error;

  /** Clears a stale error in the event itself, so the effect only fetches. */
  const navigateTo = (next: string) => {
    setError("");
    setPath(next);
  };

  useEffect(() => {
    const controller = new AbortController();
    const url = path ? `/api/browse?path=${encodeURIComponent(path)}` : "/api/browse";
    fetchJson<Listing>(url, { signal: controller.signal })
      .then((data) => {
        setListing(data);
        setError("");
      })
      .catch((err) => {
        if (!controller.signal.aborted) setError(messageOf(err));
      });
    return () => controller.abort();
  }, [path]);

  // Escape closes the dialog, matching the backdrop click.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  const directories = (listing?.directories || []).filter(
    (name) => showHidden || !name.startsWith("."),
  );
  const hiddenCount = (listing?.directories || []).length - directories.length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm cursor-zoom-out"
        onClick={onCancel}
        aria-hidden="true"
      />

      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Choose a folder for the new session"
        className="relative w-full max-w-lg h-128 flex flex-col bg-stone-950/90 backdrop-blur-3xl border border-white/10 rounded-[2rem] shadow-[0_20px_80px_rgba(0,0,0,0.8)] overflow-hidden animate-in fade-in zoom-in-95 duration-200"
      >
        <div className="p-6 border-b border-white/10 bg-linear-to-b from-white/5 to-transparent shrink-0">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <FolderOpen className="w-5 h-5 text-amber-400" aria-hidden="true" />
                New session in…
              </h2>
              <p
                className="mt-2 font-mono text-xs text-amber-200/80 truncate"
                title={listing?.path}
              >
                {listing ? shortenPath(listing.path) : "…"}
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={onCancel}
              className="shrink-0 rounded-full bg-white/5 hover:bg-white/20 dark:hover:bg-white/20 text-stone-300 hover:text-white"
              aria-label="Cancel"
            >
              <X className="w-5 h-5" aria-hidden="true" />
            </Button>
          </div>

          <div className="mt-4 flex items-center justify-between gap-3">
            <Button
              variant="ghost"
              onClick={() => listing?.parent && navigateTo(listing.parent)}
              disabled={!listing?.parent}
              className="h-auto gap-2 px-3 py-1.5 bg-white/5 hover:bg-white/10 dark:hover:bg-white/10 text-stone-300 hover:text-white rounded-xl text-xs font-bold"
            >
              <CornerLeftUp className="w-4 h-4" aria-hidden="true" /> Up
            </Button>
            <label className="flex items-center gap-2 text-xs font-semibold text-stone-400 uppercase tracking-widest cursor-pointer hover:text-white transition-colors">
              <input
                type="checkbox"
                checked={showHidden}
                onChange={(e) => setShowHidden(e.target.checked)}
                className="accent-amber-500 w-3.5 h-3.5 cursor-pointer"
              />
              Hidden {hiddenCount > 0 && !showHidden ? `(${hiddenCount})` : ""}
            </label>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar p-3">
          {loading ? (
            <p className="text-center py-10 text-stone-500 font-mono text-sm animate-pulse" role="status">
              Loading folders...
            </p>
          ) : error ? (
            <p className="text-center py-10 text-red-400 text-sm px-4">{error}</p>
          ) : directories.length === 0 ? (
            <p className="text-center py-10 text-stone-500 text-sm">
              No sub-folders here.
            </p>
          ) : (
            <ul className="space-y-1">
              {directories.map((name) => (
                <li key={name}>
                  <Button
                    variant="ghost"
                    onClick={() =>
                      navigateTo(`${listing!.path === "/" ? "" : listing!.path}/${name}`)
                    }
                    className="h-auto w-full justify-start gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-stone-300 hover:bg-amber-500/10 dark:hover:bg-amber-500/10 hover:text-amber-200"
                  >
                    <Folder className="w-4 h-4 shrink-0 text-stone-500" aria-hidden="true" />
                    <span className="truncate">{name}</span>
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="p-4 border-t border-white/10 bg-stone-900/60 flex items-center justify-end gap-3 shrink-0">
          <Button
            variant="ghost"
            onClick={onCancel}
            className="h-auto px-4 py-2.5 bg-white/5 hover:bg-white/10 dark:hover:bg-white/10 text-stone-300 hover:text-white rounded-xl font-bold"
          >
            Cancel
          </Button>
          <Button
            onClick={() => listing && onSelect(listing.path)}
            disabled={!listing}
            className="h-auto gap-2 px-5 py-2.5 bg-amber-600 hover:bg-amber-500 text-white rounded-xl font-bold"
          >
            Create session here
          </Button>
        </div>
      </div>
    </div>
  );
}
