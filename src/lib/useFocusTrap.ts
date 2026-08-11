"use client";

import { useEffect, type RefObject } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Keeps Tab focus inside `container` while it is mounted and returns focus
 * to whatever had it before. Deliberately scoped to the container element:
 * nested Base UI dialogs portal to <body>, so their key events never pass
 * through here and their own focus management stays in charge.
 */
export function useFocusTrap(
  container: RefObject<HTMLElement | null>,
  initialFocus?: RefObject<HTMLElement | null>,
) {
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const previous = document.activeElement as HTMLElement | null;

    const focusables = () =>
      [...element.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );

    (initialFocus?.current ?? focusables()[0] ?? element).focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const list = focusables();
      if (!list.length) return;
      const first = list[0];
      const last = list[list.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !element.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !element.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };
    element.addEventListener("keydown", onKeyDown);
    return () => {
      element.removeEventListener("keydown", onKeyDown);
      previous?.focus?.();
    };
    // The trap arms once per mount; both refs are stable ref objects.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
