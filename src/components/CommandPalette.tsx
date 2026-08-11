"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Clock,
  CornerDownLeft,
  Folder,
  Layers,
  MessageSquare,
  Plus,
  Search,
} from "lucide-react";
import type { SearchHit } from "@/types";
import {
  fetchJson,
  localDateKey,
  messageOf,
  OPEN_PALETTE,
  shortenPath,
} from "@/lib/utils";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import FolderPicker from "@/components/FolderPicker";
import { toast } from "@/components/ui/toast";

type PaletteEntry = {
  key: string;
  group: "Commands" | "Folders" | "Sessions";
  icon: React.ReactNode;
  title: string;
  detail?: string;
  run: () => void;
};

/**
 * Ctrl/Cmd+K: jump anywhere. Commands and folders filter as you type;
 * two or more characters also full-text search every session on disk.
 */
export default function CommandPalette() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const location = searchParams.get("location") || "";

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [locations, setLocations] = useState<string[]>([]);
  const [pickingFolder, setPickingFolder] = useState(false);
  const [selected, setSelected] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  // A fresh open starts clean and knows the current folder list. This runs
  // from event handlers (hotkey, dialog), never synchronously in an effect.
  const handleOpenChange = useCallback((next: boolean) => {
    setOpen(next);
    if (!next) return;
    setQuery("");
    setHits([]);
    setSelected(0);
    setSearching(false);
    fetchJson<{ locations: string[] }>("/api/locations")
      .then((data) => setLocations(data.locations || []))
      .catch(() => {});
  }, []);

  const openRef = useRef(open);
  useEffect(() => {
    openRef.current = open;
  }, [open]);
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        handleOpenChange(!openRef.current);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleOpenChange]);

  // The sidebar's search button opens the same palette without the hotkey.
  useEffect(() => {
    const onOpen = () => handleOpenChange(true);
    window.addEventListener(OPEN_PALETTE, onOpen);
    return () => window.removeEventListener(OPEN_PALETTE, onOpen);
  }, [handleOpenChange]);

  // Debounced full-text search once the query is worth scanning for. All
  // state changes happen inside the timer, past the debounce. Always global:
  // scoping to the sidebar's folder silently hid every other folder's
  // sessions, and each hit already names the folder it lives in.
  useEffect(() => {
    if (!open) return;
    const needle = query.trim();
    const controller = new AbortController();
    const timer = setTimeout(
      () => {
        if (needle.length < 2) {
          setHits([]);
          setSearching(false);
          return;
        }
        setSearching(true);
        const url = `/api/search?q=${encodeURIComponent(needle)}`;
        fetchJson<{ results: SearchHit[] }>(url, { signal: controller.signal })
          .then((data) => {
            setHits(data.results || []);
            setSearching(false);
          })
          .catch(() => {
            if (!controller.signal.aborted) setSearching(false);
          });
      },
      needle.length < 2 ? 0 : 250,
    );
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [open, query]);

  const createSessionIn = useCallback(
    async (cwd: string) => {
      setPickingFolder(false);
      try {
        const data = await fetchJson<{ file?: string }>("/api/new-session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cwd }),
        });
        if (data.file) {
          const params = new URLSearchParams(searchParams.toString());
          params.set("location", cwd);
          params.set("session", data.file);
          router.push(`/${encodeURIComponent(localDateKey(new Date()))}?${params.toString()}`);
        }
      } catch (err) {
        toast(messageOf(err));
      }
    },
    [router, searchParams],
  );

  const entries = useMemo<PaletteEntry[]>(() => {
    const needle = query.trim().toLowerCase();
    const matches = (text: string) => !needle || text.toLowerCase().includes(needle);
    const list: PaletteEntry[] = [];

    const commands: PaletteEntry[] = [
      {
        key: "cmd-new",
        group: "Commands",
        icon: <Plus className="h-4 w-4 text-amber-400" aria-hidden="true" />,
        title: location ? `New session in ${shortenPath(location)}` : "New session…",
        run: () => {
          setOpen(false);
          if (location) createSessionIn(location);
          else setPickingFolder(true);
        },
      },
      {
        key: "cmd-timeline",
        group: "Commands",
        icon: <Clock className="h-4 w-4 text-amber-400" aria-hidden="true" />,
        title: "Go to timeline",
        run: () => {
          setOpen(false);
          router.push(`/?${searchParams.toString()}`);
        },
      },
      {
        key: "cmd-all",
        group: "Commands",
        icon: <Layers className="h-4 w-4 text-amber-400" aria-hidden="true" />,
        title: "Show all locations",
        run: () => {
          setOpen(false);
          const params = new URLSearchParams(searchParams.toString());
          params.delete("location");
          router.push(`/?${params.toString()}`);
        },
      },
    ];
    list.push(...commands.filter((command) => matches(command.title)));

    const folders = locations
      .filter((path) => path !== location && matches(path))
      .slice(0, needle ? 6 : 4);
    list.push(
      ...folders.map((path) => ({
        key: `folder-${path}`,
        group: "Folders" as const,
        icon: <Folder className="h-4 w-4 text-stone-400" aria-hidden="true" />,
        title: shortenPath(path),
        detail: path,
        run: () => {
          setOpen(false);
          const params = new URLSearchParams(searchParams.toString());
          params.set("location", path);
          router.push(`/?${params.toString()}`);
        },
      })),
    );

    list.push(
      ...hits.map((hit) => ({
        key: `session-${hit.file}`,
        group: "Sessions" as const,
        icon: <MessageSquare className="h-4 w-4 text-stone-400" aria-hidden="true" />,
        title: hit.name || hit.preview || "Untitled Session",
        detail: `${hit.date || ""} · ${shortenPath(hit.cwd)}${
          hit.matchedIn === "message" ? ` — ${hit.snippet}` : ""
        }`,
        run: () => {
          setOpen(false);
          const params = new URLSearchParams(searchParams.toString());
          params.set("location", hit.cwd);
          params.set("session", hit.file);
          const date = hit.date || localDateKey(new Date());
          router.push(`/${encodeURIComponent(date)}?${params.toString()}`);
        },
      })),
    );

    return list;
  }, [query, location, locations, hits, router, searchParams, createSessionIn]);

  // The stored index may point past a shrunken list; clamp at render time
  // instead of chasing it with an effect.
  const selectedIndex = Math.min(selected, Math.max(0, entries.length - 1));

  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${selectedIndex}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  const onInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected(Math.min(selectedIndex + 1, entries.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected(Math.max(selectedIndex - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      entries[selectedIndex]?.run();
    }
  };

  let lastGroup: PaletteEntry["group"] | null = null;

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent
          showCloseButton={false}
          className="top-24 translate-y-0 w-full max-w-xl gap-0 overflow-hidden border border-white/10 bg-stone-950/95 p-0 text-stone-200 backdrop-blur-2xl"
        >
          <DialogTitle className="sr-only">Search sessions and commands</DialogTitle>
          <div className="flex items-center gap-3 border-b border-white/10 px-4 py-3">
            <Search className="h-4 w-4 shrink-0 text-stone-500" aria-hidden="true" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onInputKeyDown}
              placeholder="Search sessions, folders, commands…"
              aria-label="Search sessions, folders, and commands"
              className="w-full bg-transparent text-sm text-stone-200 placeholder-stone-500 focus:outline-none"
            />
            {searching && (
              <span className="shrink-0 animate-pulse font-mono text-[10px] text-stone-500">
                searching…
              </span>
            )}
          </div>
          <div ref={listRef} className="custom-scrollbar max-h-96 overflow-y-auto p-2">
            {entries.length === 0 ? (
              <p className="px-3 py-8 text-center font-mono text-xs text-stone-500">
                {query.trim().length >= 2 && !searching
                  ? "Nothing matches."
                  : "Type to search across every session."}
              </p>
            ) : (
              entries.map((entry, index) => {
                const header = entry.group !== lastGroup ? entry.group : null;
                lastGroup = entry.group;
                return (
                  <div key={entry.key}>
                    {header && (
                      <div className="px-3 pt-2 pb-1 text-[10px] font-bold uppercase tracking-widest text-stone-600">
                        {header}
                      </div>
                    )}
                    <button
                      type="button"
                      data-index={index}
                      onClick={entry.run}
                      onMouseMove={() => setSelected(index)}
                      className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm ${
                        index === selectedIndex
                          ? "bg-amber-500/15 text-white"
                          : "text-stone-300 hover:bg-white/5"
                      }`}
                    >
                      <span className="shrink-0">{entry.icon}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{entry.title}</span>
                        {entry.detail && (
                          <span className="block truncate font-mono text-[11px] text-stone-500">
                            {entry.detail}
                          </span>
                        )}
                      </span>
                      {index === selectedIndex && (
                        <CornerDownLeft
                          className="h-3.5 w-3.5 shrink-0 text-stone-500"
                          aria-hidden="true"
                        />
                      )}
                    </button>
                  </div>
                );
              })
            )}
          </div>
          <div className="border-t border-white/10 px-4 py-2 font-mono text-[10px] text-stone-600">
            ↑↓ navigate · ↵ open · esc close
          </div>
        </DialogContent>
      </Dialog>

      {pickingFolder && (
        <FolderPicker
          onCancel={() => setPickingFolder(false)}
          onSelect={createSessionIn}
        />
      )}
    </>
  );
}
