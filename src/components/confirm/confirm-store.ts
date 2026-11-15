/**
 * Promise-based replacement for `window.confirm()`.
 *
 * Native confirm blocks the whole renderer, ignores the app's typography and
 * colours, and cannot carry a title or a distinct confirm label. Call sites
 * keep their existing shape:
 *
 *     if (!(await confirmAction({ title, message, confirmLabel, tone: "danger" }))) return;
 *
 * One request is shown at a time; a second request while one is open resolves
 * the first as cancelled so a stray click can never leave a promise pending.
 */

export type ConfirmTone = "danger" | "default";

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: ConfirmTone;
}

export interface ConfirmRequest extends ConfirmOptions {
  id: number;
}

type Listener = () => void;

let nextId = 1;
let current: ConfirmRequest | null = null;

let pendingResolve: ((confirmed: boolean) => void) | null = null;

const listeners = new Set<Listener>();

function emit(): void {
  listeners.forEach(listener => listener());
}

export function confirmAction(options: ConfirmOptions): Promise<boolean> {

  // A dialog that was already on screen can only be for one action; treat the
  // new request as superseding it rather than queueing behind a stale one.
  if (pendingResolve) {

    const previous = pendingResolve;
    pendingResolve = null;
    previous(false);

  }

  return new Promise<boolean>(resolve => {

    pendingResolve = resolve;

    current = {
      id: nextId++,
      title: options.title,
      message: options.message,
      confirmLabel: options.confirmLabel,
      cancelLabel: options.cancelLabel,
      tone: options.tone ?? "default"
    };

    emit();

  });

}

export function resolveConfirm(confirmed: boolean): void {

  const resolve = pendingResolve;

  pendingResolve = null;
  current = null;

  emit();

  resolve?.(confirmed);

}

export function subscribe(listener: Listener): () => void {

  listeners.add(listener);

  return () => {

    listeners.delete(listener);

  };

}

export function getConfirmRequest(): ConfirmRequest | null {

  return current;

}
