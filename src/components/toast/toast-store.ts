/**
 * Application-wide toast store.
 *
 * Page-level failures (delete, export, print, permissions) used to call native
 * `window.alert()`, which blocks the renderer, cannot be styled or translated
 * consistently, and cannot be announced politely. This store is the single
 * replacement surface: call sites push a message and `<ToastViewport>` (mounted
 * once in `main.tsx`) renders it.
 *
 * Deliberately a module-level store rather than a React context: several call
 * sites are plain async handlers and helpers outside the component tree, and a
 * context would force every one of them through a hook.
 */

export type ToastVariant = "success" | "error" | "warning" | "info";

export interface ToastOptions {
  /** Heading above the message. Optional — most calls are a single sentence. */
  title?: string;
  /** Override the per-variant auto-dismiss delay, in ms. Use 0 to keep it open. */
  duration?: number;
}

export interface ToastItem {
  id: number;
  variant: ToastVariant;
  message: string;
  title?: string;
  duration: number;
  /** Set while the exit animation runs; the item is removed right after. */
  leaving: boolean;
}

type Listener = () => void;

/** Errors stay longest because they usually carry an action to recover from. */
const DEFAULT_DURATION: Record<ToastVariant, number> = {
  success: 4500,
  info: 5000,
  warning: 7000,
  error: 9000
};

const EXIT_MS = 180;

/** More than this and the stack covers the work the user is trying to redo. */
const MAX_VISIBLE = 4;

let nextId = 1;
let items: ToastItem[] = [];

const listeners = new Set<Listener>();
const timers = new Map<number, ReturnType<typeof setTimeout>>();

function emit(): void {
  listeners.forEach(listener => listener());
}

function clearTimer(id: number): void {
  const timer = timers.get(id);

  if (timer !== undefined) {
    clearTimeout(timer);
    timers.delete(id);
  }
}

function scheduleRemoval(id: number, delay: number): void {
  clearTimer(id);

  if (delay <= 0) {

    return;

  }

  timers.set(
    id,
    setTimeout(() => {

      dismiss(id);

    }, Math.max(delay, 0))
  );
}

function show(
  variant: ToastVariant,
  message: string,
  options: ToastOptions = {}
): number {

  const text = typeof message === "string" ? message.trim() : "";

  // An empty toast is a bug at the call site, not a message for the user.
  if (!text) {

    return 0;

  }

  const id = nextId++;

  const duration =
    typeof options.duration === "number"
      ? options.duration
      : DEFAULT_DURATION[variant];

  const next = [
    ...items,
    {
      id,
      variant,
      message: text,
      title: options.title?.trim() || undefined,
      duration,
      leaving: false
    }
  ];

  // Drop the oldest entries once the stack is full, and stop their timers so a
  // queued dismissal cannot remove a newer toast with a recycled id.
  while (next.length > MAX_VISIBLE) {

    const dropped = next.shift();

    if (dropped) {

      clearTimer(dropped.id);

    }

  }

  items = next;

  emit();

  scheduleRemoval(id, duration);

  return id;

}

/**
 * Marks a toast as leaving so the viewport can play its exit animation, then
 * removes it. Calling it twice is safe.
 */
export function dismiss(id: number): void {

  const target = items.find(item => item.id === id);

  if (!target || target.leaving) {

    return;

  }

  clearTimer(id);

  items = items.map(item =>
    item.id === id ? { ...item, leaving: true } : item
  );

  emit();

  setTimeout(() => {

    items = items.filter(item => item.id !== id);
    emit();

  }, EXIT_MS);

}

export function dismissAll(): void {

  items.forEach(item => clearTimer(item.id));

  items = [];

  emit();

}

export function subscribe(listener: Listener): () => void {

  listeners.add(listener);

  return () => {

    listeners.delete(listener);

  };

}

/** Stable snapshot for `useSyncExternalStore` — only replaced on real changes. */
export function getToasts(): ToastItem[] {

  return items;

}

export const toast = {

  show,

  success: (message: string, options?: ToastOptions) =>
    show("success", message, options),

  error: (message: string, options?: ToastOptions) =>
    show("error", message, options),

  warning: (message: string, options?: ToastOptions) =>
    show("warning", message, options),

  info: (message: string, options?: ToastOptions) =>
    show("info", message, options),

  dismiss,

  dismissAll

};
