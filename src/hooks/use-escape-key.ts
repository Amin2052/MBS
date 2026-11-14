import { useEffect } from "react";

/**
 * Dismisses a modal/drawer when Escape is pressed.
 *
 * Every data-entry dialog in the app renders as a plain `.modal-overlay` div
 * with a close (×) button, so until now a keyboard user could only leave one by
 * tabbing to that button — Escape did nothing. This hook gives all of them the
 * behaviour people expect, without changing any dialog markup or state shape.
 *
 * `onEscape` is intentionally not memoised by callers: the effect re-subscribes
 * when it changes, which is cheap and keeps the handler closing over fresh
 * state (e.g. a half-filled form).
 */
export function useEscapeKey(active: boolean, onEscape: () => void): void {
  useEffect(() => {
    if (!active) return;

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key !== "Escape") return;

      // Don't let the same keypress also close a parent popover/menu.
      event.stopPropagation();
      onEscape();
    }

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [active, onEscape]);
}
