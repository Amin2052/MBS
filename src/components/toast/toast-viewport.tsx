import { useSyncExternalStore } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  X,
  XCircle
} from "lucide-react";

import { useLanguage } from "@/hooks/use-language";

import {
  dismiss,
  getToasts,
  subscribe,
  type ToastVariant
} from "./toast-store";

import "./toast.css";

const ICONS: Record<ToastVariant, typeof Info> = {
  success: CheckCircle2,
  error: XCircle,
  warning: AlertTriangle,
  info: Info
};

/**
 * Renders the toast stack once, at the root. `--z-toast` already existed in the
 * theme layer for this purpose, so messages sit above open dialogs.
 */
export function ToastViewport(): JSX.Element | null {

  const { t } = useLanguage();

  const items = useSyncExternalStore(
    subscribe,
    getToasts,
    getToasts
  );

  if (!items.length) {

    return null;

  }

  return (
    <div className="toast-viewport">
      {items.map(item => {

        const Icon = ICONS[item.variant];

        return (
          <div
            key={item.id}
            className={`toast toast-${item.variant}${item.leaving ? " toast-leaving" : ""}`}
            // Errors interrupt, everything else waits for a pause in speech.
            role={item.variant === "error" ? "alert" : "status"}
            aria-live={item.variant === "error" ? "assertive" : "polite"}
          >
            <Icon className="toast-icon" size={18} aria-hidden="true" />

            <div className="toast-body">
              {item.title ? (
                <p className="toast-title">{item.title}</p>
              ) : null}
              <p className="toast-message">{item.message}</p>
            </div>

            <button
              type="button"
              className="toast-dismiss"
              onClick={() => dismiss(item.id)}
              title={t("common.close")}
              aria-label={t("common.close")}
            >
              <X size={14} aria-hidden="true" />
            </button>
          </div>
        );

      })}
    </div>
  );

}

export default ToastViewport;
