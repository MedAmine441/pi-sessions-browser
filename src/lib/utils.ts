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

/** Renders a canonical YYYY-MM-DD key (or any ISO timestamp) for display. */
export function formatReadableDate(dateString: string) {
  // A bare key would otherwise parse as UTC midnight and show the wrong day.
  const date = /^\d{4}-\d{2}-\d{2}$/.test(dateString)
    ? new Date(`${dateString}T00:00:00`)
    : new Date(dateString);
  if (isNaN(date.getTime())) return dateString;
  return format(date, "PPP");
}
