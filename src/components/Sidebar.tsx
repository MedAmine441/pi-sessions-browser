"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { FolderGit2, Menu, Pin, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { SessionInfo } from "@/types";
import {
  dateKeyOfSessionFile,
  fetchJson,
  localDateKey,
  LOCATIONS_CHANGED,
  PINS_CHANGED,
  shortenPath,
} from "@/lib/utils";
import PiControls from "@/components/PiControls";

type LocationsResponse = { locations?: string[]; defaultLocation?: string };

export default function Sidebar() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();

  const [locations, setLocations] = useState<string[]>([]);
  const [defaultLocation, setDefaultLocation] = useState("");
  const [loading, setLoading] = useState(true);
  const [isOpen, setIsOpen] = useState(false);
  const [pinnedSessions, setPinnedSessions] = useState<SessionInfo[]>([]);

  // Pinned sessions surface here regardless of the date they live under.
  useEffect(() => {
    const loadPins = () =>
      fetchJson<{ sessions: SessionInfo[] }>("/api/pins")
        .then((data) => setPinnedSessions(data.sessions || []))
        .catch(() => {});
    loadPins();
    window.addEventListener(PINS_CHANGED, loadPins);
    window.addEventListener(LOCATIONS_CHANGED, loadPins);
    return () => {
      window.removeEventListener(PINS_CHANGED, loadPins);
      window.removeEventListener(LOCATIONS_CHANGED, loadPins);
    };
  }, []);

  const openPinnedSession = (session: SessionInfo) => {
    const params = new URLSearchParams(window.location.search);
    params.set("location", session.cwd);
    params.set("session", session.file);
    const date = dateKeyOfSessionFile(session.file) || localDateKey(new Date());
    router.push(`/${encodeURIComponent(date)}?${params.toString()}`);
    setIsOpen(false);
  };

  const currentLocation = searchParams.get("location") || "";

  const loadLocations = useCallback(
    () =>
      fetchJson<LocationsResponse>("/api/locations").then((data) => {
        setLocations(data.locations || []);
        setDefaultLocation(data.defaultLocation || "");
        return data;
      }),
    [],
  );

  /** Rescopes the current page without treating it as a navigation. */
  const updateLocation = useCallback(
    (location: string) => {
      // Read the live URL: this also runs from an event fired while another
      // component is mid-navigation, and the rendered snapshot can lag behind.
      const params = new URLSearchParams(window.location.search);
      if (location) params.set("location", location);
      else params.delete("location");
      router.replace(`${pathname}?${params.toString()}`);
    },
    [pathname, router],
  );

  /** Picking a folder is a navigation: it opens that folder's timeline. */
  const pickLocation = (location: string) => {
    const params = new URLSearchParams(window.location.search);
    if (location) params.set("location", location);
    else params.delete("location");
    params.delete("session");
    router.push(`/?${params.toString()}`);
    setIsOpen(false);
  };

  useEffect(() => {
    loadLocations()
      .catch((err) => console.error(err))
      .finally(() => setLoading(false));
  }, [loadLocations]);

  // The home folder is only a default for the bare root page. Deep links to a
  // date or session keep the scope they arrived with.
  const appliedDefault = useRef(false);
  useEffect(() => {
    if (appliedDefault.current || !defaultLocation) return;
    appliedDefault.current = true;
    if (pathname === "/" && !currentLocation) updateLocation(defaultLocation);
  }, [defaultLocation, pathname, currentLocation, updateLocation]);

  // Creating or deleting a session can add or retire a whole location.
  useEffect(() => {
    const onChanged = () =>
      loadLocations()
        .then(data => {
          // Nothing is left in the folder being viewed, so stop viewing it.
          if (currentLocation && !(data.locations || []).includes(currentLocation)) {
            updateLocation("");
          }
        })
        .catch(err => console.error(err));
    window.addEventListener(LOCATIONS_CHANGED, onChanged);
    return () => window.removeEventListener(LOCATIONS_CHANGED, onChanged);
  }, [currentLocation, loadLocations, updateLocation]);

  // A session that has just been created has no messages yet, so its folder is
  // not a location the API reports — show it anyway while it is being viewed.
  const shown =
    currentLocation && !locations.includes(currentLocation)
      ? [...locations, currentLocation].sort((a, b) => a.localeCompare(b))
      : locations;

  const itemClasses = (isActive: boolean) =>
    `h-auto w-full justify-start gap-3 rounded-xl border px-3 py-3 text-left transition-all ${
      isActive
        ? "bg-amber-500/20 text-amber-400 border-amber-500/30 font-bold shadow-[0_0_15px_rgba(217,119,6,0.1)] hover:bg-amber-500/30 dark:hover:bg-amber-500/30 hover:text-amber-300"
        : "text-stone-400 border-transparent hover:bg-stone-900 dark:hover:bg-stone-900 hover:text-stone-200"
    }`;

  return (
    <>
      {/* Mobile Burger Button */}
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setIsOpen(true)}
        aria-label="Open locations menu"
        aria-expanded={isOpen}
        aria-controls="locations-sidebar"
        className="md:hidden fixed top-6 left-4 z-40 size-9 bg-stone-900/80 backdrop-blur-md border border-white/10 rounded-xl text-stone-300 hover:bg-stone-800 dark:hover:bg-stone-800 hover:text-white"
      >
        <Menu className="w-5 h-5" />
      </Button>

      {/* Mobile Overlay */}
      {isOpen && (
        <div
          className="md:hidden fixed inset-0 bg-black/60 backdrop-blur-sm z-40"
          onClick={() => setIsOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar Container */}
      <nav
        id="locations-sidebar"
        aria-label="Session locations"
        className={`
        fixed md:relative top-0 left-0 h-full z-50
        w-72 border-r border-white/10 bg-stone-950/90 backdrop-blur-xl flex flex-col pointer-events-auto p-4 shrink-0
        transition-transform duration-300 ease-in-out
        ${isOpen ? 'translate-x-0' : '-translate-x-full'}
        md:translate-x-0
      `}>
        <div className="mb-6 mt-2 px-2 flex items-center justify-between">
          <h2 className="text-xl font-black text-amber-500 tracking-tight flex items-center gap-2">
            Pi Sessions Browser
          </h2>
          <Button
            variant="ghost"
            size="icon-sm"
            className="md:hidden text-stone-400 hover:bg-white/10 dark:hover:bg-white/10 hover:text-white"
            onClick={() => setIsOpen(false)}
            aria-label="Close locations menu"
          >
            <X className="w-5 h-5" />
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar pr-2">
          {pinnedSessions.length > 0 && (
            <section aria-label="Pinned sessions" className="mb-4">
              <h3 className="px-2 pb-1 text-[10px] font-bold uppercase tracking-widest text-stone-600">
                Pinned
              </h3>
              <ul className="space-y-1">
                {pinnedSessions.map((session) => (
                  <li key={session.file}>
                    <Button
                      variant="ghost"
                      onClick={() => openPinnedSession(session)}
                      className={itemClasses(false)}
                      title={session.name || session.preview || session.file}
                    >
                      <Pin className="w-4 h-4 shrink-0 text-amber-500/70" aria-hidden="true" />
                      <span className="min-w-0 flex-1 truncate text-sm">
                        {session.name || session.preview || "Untitled Session"}
                      </span>
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {loading ? (
            <p className="text-sm text-stone-500 animate-pulse px-2">Loading locations...</p>
          ) : shown.length === 0 ? (
            <p className="text-sm text-stone-500 px-2">No locations found</p>
          ) : (
            <ul className="space-y-1">
              <li>
                <Button
                  variant="ghost"
                  onClick={() => pickLocation("")}
                  aria-current={currentLocation === "" ? "true" : undefined}
                  className={itemClasses(currentLocation === "")}
                >
                  <FolderGit2 className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span className="truncate text-sm">All Locations</span>
                </Button>
              </li>

              {shown.map(loc => (
                <li key={loc}>
                  <Button
                    variant="ghost"
                    onClick={() => pickLocation(loc)}
                    aria-current={currentLocation === loc ? "true" : undefined}
                    className={itemClasses(currentLocation === loc)}
                    title={loc}
                  >
                    <FolderGit2 className="w-4 h-4 shrink-0" aria-hidden="true" />
                    <span className="truncate text-sm">{shortenPath(loc)}</span>
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <PiControls />
      </nav>
    </>
  );
}
