import { CircleAlert, CircleCheck, Info, TriangleAlert, X, type LucideIcon } from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { Button, IconButton } from './ui';

// ── Dialog ────────────────────────────────────────────────────────────────

export function Dialog({
  title,
  onClose,
  children,
  actions,
  wide,
  icon: Icon,
  className = '',
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  actions?: ReactNode;
  wide?: boolean;
  icon?: LucideIcon;
  className?: string;
}) {
  const titleId = useId();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const el = ref.current;
    const first = el?.querySelector<HTMLElement>('[data-autofocus], input, select, textarea, button:not([aria-label="Close"])');
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
      if (e.key === 'Tab' && el) {
        const focusable = [...el.querySelectorAll<HTMLElement>('button, input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter(
          (n) => !n.hasAttribute('disabled'),
        );
        if (focusable.length === 0) return;
        const firstEl = focusable[0] as HTMLElement;
        const lastEl = focusable[focusable.length - 1] as HTMLElement;
        if (e.shiftKey && document.activeElement === firstEl) {
          e.preventDefault();
          lastEl.focus();
        } else if (!e.shiftKey && document.activeElement === lastEl) {
          e.preventDefault();
          firstEl.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      previous?.focus?.();
    };
  }, [onClose]);

  return createPortal(
    <div className="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className={`dialog ${wide ? 'dialog-wide' : ''} ${className}`} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="dialog-header">
          {Icon && <Icon size={24} aria-hidden="true" style={{ color: 'var(--accent)', flexShrink: 0, marginTop: 2 }} />}
          <h2 id={titleId} className="dialog-title" style={{ flex: 1 }}>
            {title}
          </h2>
          <IconButton icon={X} label="Close" size="sm" onClick={onClose} />
        </div>
        <div className="dialog-body">{children}</div>
        {actions && <div className="dialog-actions">{actions}</div>}
      </div>
    </div>,
    document.body,
  );
}

// ── Toasts ────────────────────────────────────────────────────────────────

export type ToastTone = 'success' | 'error' | 'warning' | 'info';

export interface ToastOptions {
  title: string;
  description?: string;
  tone?: ToastTone;
  durationMs?: number;
}

interface ToastItem extends ToastOptions {
  id: number;
}

const ToastContext = createContext<(t: ToastOptions) => void>(() => {});

const TONE_ICONS: Record<ToastTone, LucideIcon> = {
  success: CircleCheck,
  error: CircleAlert,
  warning: TriangleAlert,
  info: Info,
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const counter = useRef(0);
  const push = useCallback((t: ToastOptions) => {
    const id = ++counter.current;
    setToasts((list) => [...list.slice(-3), { ...t, id }]);
    const duration = t.durationMs ?? (t.tone === 'error' ? 7000 : 3500);
    setTimeout(() => setToasts((list) => list.filter((x) => x.id !== id)), duration);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      {createPortal(
        <div className="toasts" role="status" aria-live="polite">
          {toasts.map((t) => {
            const Icon = TONE_ICONS[t.tone ?? 'info'];
            return (
              <div key={t.id} className={`toast toast-${t.tone ?? 'info'}`}>
                <Icon className="toast-icon" size={20} aria-hidden="true" />
                <div style={{ flex: 1 }}>
                  <div className="toast-title">{t.title}</div>
                  {t.description && <div className="toast-desc">{t.description}</div>}
                </div>
                <button
                  type="button"
                  aria-label="Dismiss"
                  onClick={() => setToasts((list) => list.filter((x) => x.id !== t.id))}
                  style={{ background: 'none', border: 'none', color: 'inherit', opacity: 0.7, padding: 2 }}
                >
                  <X size={16} />
                </button>
              </div>
            );
          })}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}

export function useToast(): (t: ToastOptions) => void {
  return useContext(ToastContext);
}

// ── Confirm dialog ────────────────────────────────────────────────────────

export interface ConfirmOptions {
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

const ConfirmContext = createContext<(o: ConfirmOptions) => Promise<boolean>>(async () => false);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null);
  const confirm = useCallback(
    (o: ConfirmOptions) => new Promise<boolean>((resolve) => setPending({ ...o, resolve })),
    [],
  );
  const close = (v: boolean) => {
    pending?.resolve(v);
    setPending(null);
  };
  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {pending && (
        <Dialog
          title={pending.title}
          icon={pending.danger ? TriangleAlert : Info}
          onClose={() => close(false)}
          actions={
            <>
              <Button onClick={() => close(false)}>{pending.cancelLabel ?? 'Cancel'}</Button>
              <Button variant={pending.danger ? 'danger-solid' : 'primary'} data-autofocus onClick={() => close(true)}>
                {pending.confirmLabel ?? 'OK'}
              </Button>
            </>
          }
        >
          <div className="muted">{pending.message}</div>
        </Dialog>
      )}
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): (o: ConfirmOptions) => Promise<boolean> {
  return useContext(ConfirmContext);
}

// ── Popover menu ──────────────────────────────────────────────────────────

export function Menu({
  anchor,
  onClose,
  children,
  label,
  align = 'start',
}: {
  anchor: HTMLElement | null;
  onClose: () => void;
  children: ReactNode;
  label: string;
  align?: 'start' | 'end';
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!anchor || !ref.current) return;
    const a = anchor.getBoundingClientRect();
    const m = ref.current.getBoundingClientRect();
    let left = align === 'end' ? a.right - m.width : a.left;
    left = Math.max(8, Math.min(left, window.innerWidth - m.width - 8));
    let top = a.bottom + 6;
    if (top + m.height > window.innerHeight - 8) top = Math.max(8, a.top - m.height - 6);
    setPos({ top, left });
  }, [anchor, align]);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (ref.current?.contains(e.target as Node) || anchor?.contains(e.target as Node)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const items = [...(ref.current?.querySelectorAll<HTMLElement>('.menu-item:not(:disabled)') ?? [])];
        const i = items.indexOf(document.activeElement as HTMLElement);
        const next = e.key === 'ArrowDown' ? items[(i + 1) % items.length] : items[(i - 1 + items.length) % items.length];
        next?.focus();
        e.preventDefault();
      }
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    ref.current?.querySelector<HTMLElement>('.menu-item')?.focus();
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [anchor, onClose]);

  return createPortal(
    <div
      ref={ref}
      className="menu"
      role="menu"
      aria-label={label}
      style={pos ? { top: pos.top, left: pos.left } : { top: -9999, left: -9999 }}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('.menu-item')) onClose();
      }}
    >
      {children}
    </div>,
    document.body,
  );
}

export function MenuItem({
  icon: Icon,
  label,
  hint,
  onSelect,
  disabled,
  danger,
}: {
  icon?: LucideIcon;
  label: string;
  hint?: string;
  onSelect: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button type="button" role="menuitem" className={`menu-item ${danger ? 'danger' : ''}`} disabled={disabled} onClick={onSelect}>
      {Icon && <Icon size={18} aria-hidden="true" />}
      <span>{label}</span>
      {hint && <span className="menu-hint">{hint}</span>}
    </button>
  );
}
