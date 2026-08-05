import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

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

/** Drops the home prefix so paths read as "pc" and "pc/Pictures". */
export function shortenPath(path: string) {
  return path.replace(/^\/(?:home|Users)\//, "") || path;
}

export function getOrdinalSuffix(i: number) {
  const j = i % 10,
        k = i % 100;
  if (j == 1 && k != 11) {
      return i + "st";
  }
  if (j == 2 && k != 12) {
      return i + "nd";
  }
  if (j == 3 && k != 13) {
      return i + "rd";
  }
  return i + "th";
}

export function formatReadableDate(dateString: string) {
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return dateString;
  
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  
  const month = months[date.getMonth()];
  const day = getOrdinalSuffix(date.getDate());
  const year = date.getFullYear();
  
  return `${month} ${day}, ${year}`;
}
