import { useEffect, useRef, useSyncExternalStore } from "react";

import { useEscapeKey } from "@/hooks/use-escape-key";
import { useLanguage } from "@/hooks/use-language";

import {
  getConfirmRequest,
  resolveConfirm,
  subscribe
} from "./confirm-store";

import "./confirm-dialog.css";

/**
 * Renders the pending `confirmAction()` request.
 *
 * Built on the design system's modal shell (`.ga-modal*`) rather than the
 * page-local `.modal-overlay` markup, so it is available anywhere — including
 * the settings pages, which do not import a page stylesheet.
 */
export function ConfirmDialog(): JSX.Element | null {

  const { t } = useLanguage();

  const request = useSyncExternalStore(
    subscribe,
    getConfirmRequest,
    getConfirmRequest
  );

  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);

  useEscapeKey(Boolean(request), () => resolveConfirm(false));

  useEffect(() => {

    if (!request) {

      return;

    }

    // Focusing Cancel keeps the safe choice one Enter away from a stray keystroke.
    cancelRef.current?.focus();

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {

      document.body.style.overflow = previousOverflow;

    };

  }, [request?.id]);

  if (!request) {

    return null;

  }

  // Keep Tab inside the dialog while it is modal.
  function trapFocus(event: React.KeyboardEvent<HTMLDivElement>): void {

    if (event.key !== "Tab") {

      return;

    }

    const focusable = cardRef.current?.querySelectorAll<HTMLElement>(
      "button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex='-1'])"
    );

    if (!focusable || !focusable.length) {

      return;

    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (event.shiftKey && document.activeElement === first) {

      event.preventDefault();
      last.focus();

    } else if (!event.shiftKey && document.activeElement === last) {

      event.preventDefault();
      first.focus();

    }

  }

  return (
    <div
      className="ga-modal-backdrop confirm-backdrop"
      onMouseDown={event => {

        // Only a click on the backdrop itself cancels; a drag that started
        // inside the card must not be treated as a dismissal.
        if (event.target === event.currentTarget) {

          resolveConfirm(false);

        }

      }}
    >
      <div
        ref={cardRef}
        className="ga-modal ga-modal--sm confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-message"
        onKeyDown={trapFocus}
      >
        <div className="ga-modal__header">
          <span id="confirm-dialog-title" className="ga-modal__title">
            {request.title}
          </span>
        </div>

        <div className="ga-modal__body">
          <p id="confirm-dialog-message" className="confirm-message">
            {request.message}
          </p>
        </div>

        <div className="ga-modal__footer">
          <button
            ref={cancelRef}
            type="button"
            className="ga-btn ga-btn--ghost"
            onClick={() => resolveConfirm(false)}
          >
            {request.cancelLabel ?? t("common.cancel")}
          </button>

          <button
            type="button"
            className={
              request.tone === "danger"
                ? "ga-btn ga-btn--danger"
                : "ga-btn ga-btn--primary"
            }
            onClick={() => resolveConfirm(true)}
          >
            {request.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );

}

export default ConfirmDialog;
