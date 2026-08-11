import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { format } from "date-fns"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Fired whenever a session is created or removed: a folder only counts as a
 * location while it holds sessions, so the sidebar has to look again.
 */
export const LOCATIONS_CHANGED = "pi-sessions:locations-changed";

export function announceLocationsChanged() {
  window.dispatchEvent(new Event(LOCATIONS_CHANGED));
}

/** Fired whenever a session is pinned or unpinned, for the sidebar list. */
export const PINS_CHANGED = "pi-sessions:pins-changed";

export function announcePinsChanged() {
  window.dispatchEvent(new Event(PINS_CHANGED));
}

/**
 * Fetch + parse + error extraction in one place, so response shapes are typed
 * at the boundary and API error payloads become thrown messages.
 */
export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const message = (data as { error?: string } | null)?.error;
    throw new Error(message || `Request failed (${res.status})`);
  }
  return data as T;
}

/** The message of an unknown thrown value, for catch blocks. */
export function messageOf(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

/** Drops the home prefix so paths read as "pc" and "pc/Pictures". */
export function shortenPath(path: string) {
  return path.replace(/^\/(?:home|Users)\//, "") || path;
}

/**
 * The canonical date key used in URLs, grouping, and filtering: the local
 * calendar day as YYYY-MM-DD. Locale-formatted dates only appear at render
 * time, via formatReadableDate.
 */
export function localDateKey(date: Date) {
  return format(date, "yyyy-MM-dd");
}

/** Dollar cost, with enough precision to not round small turns to zero. */
export function formatCost(cost: number) {
  return cost >= 0.1 ? `$${cost.toFixed(2)}` : `$${cost.toFixed(4)}`;
}

/** Token counts as 1.2k / 3.4M once they stop being readable raw. */
export function formatTokens(count: number) {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k`;
  return String(count);
}

/** File sizes for session cards. */
export function formatBytes(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

/**
 * The timeline date key a session file lives under: sessions are grouped by
 * the UTC stamp in their filename, converted to the local day.
 */
export function dateKeyOfSessionFile(file: string) {
  const match = file.match(
    /(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z[^/]*\.jsonl$/,
  );
  if (!match) return null;
  const [, date, h, m, s, ms] = match;
  const parsed = new Date(`${date}T${h}:${m}:${s}.${ms}Z`);
  return Number.isNaN(parsed.getTime()) ? null : localDateKey(parsed);
}

/** Renders a canonical YYYY-MM-DD key (or any ISO timestamp) for display. */
export function formatReadableDate(dateString: string) {
  // A bare key would otherwise parse as UTC midnight and show the wrong day.
  const date = /^\d{4}-\d{2}-\d{2}$/.test(dateString)
    ? new Date(`${dateString}T00:00:00`)
    : new Date(dateString);
  if (isNaN(date.getTime())) return dateString;
  return format(date, "PPP");
}
