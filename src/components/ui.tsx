import { ChevronRight, Search, type LucideIcon } from 'lucide-react';
import { forwardRef, useId, type ButtonHTMLAttributes, type ReactNode } from 'react';

type ButtonVariant = 'default' | 'primary' | 'ghost' | 'danger' | 'danger-solid' | 'play' | 'stop';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: 'sm' | 'md' | 'lg';
  icon?: LucideIcon;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'default', size = 'md', icon: Icon, className = '', children, type = 'button', ...rest },
  ref,
) {
  const cls = [
    'btn',
    variant === 'primary' && 'btn-primary',
    variant === 'ghost' && 'btn-ghost',
    variant === 'danger' && 'btn-danger',
    variant === 'danger-solid' && 'btn-danger-solid',
    variant === 'play' && 'btn-play',
    variant === 'stop' && 'btn-stop',
    size === 'sm' && 'btn-sm',
    size === 'lg' && 'btn-lg',
    className,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <button ref={ref} type={type} className={cls} {...rest}>
      {Icon && <Icon size={size === 'sm' ? 15 : 18} aria-hidden="true" />}
      {children}
    </button>
  );
});

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: LucideIcon;
  label: string;
  /** Show the text label under the icon (beginner mode / touch). */
  showLabel?: boolean;
  active?: boolean;
  size?: 'sm' | 'md';
  tooltip?: string;
  tooltipPos?: 'bottom' | 'right' | 'top';
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon: Icon, label, showLabel, active, size = 'md', tooltip, tooltipPos, className = '', type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      aria-pressed={active === undefined ? undefined : active}
      data-tooltip={showLabel ? undefined : (tooltip ?? label)}
      data-tooltip-pos={tooltipPos}
      className={`icon-btn ${size === 'sm' ? 'icon-btn-sm' : ''} ${className}`}
      {...rest}
    >
      <Icon size={size === 'sm' ? 16 : 20} aria-hidden="true" />
      {showLabel && <span className="icon-label">{label}</span>}
    </button>
  );
});

export function Switch({
  checked,
  onChange,
  label,
  disabled,
  hideLabel,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
  hideLabel?: boolean;
}) {
  return (
    <label className="switch">
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} aria-label={hideLabel ? label : undefined} />
      <span className="switch-track" aria-hidden="true" />
      {!hideLabel && <span>{label}</span>}
    </label>
  );
}

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  icon?: LucideIcon;
  hideLabel?: boolean;
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: SegmentOption<T>[];
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          aria-label={o.hideLabel ? o.label : undefined}
          data-tooltip={o.hideLabel ? o.label : undefined}
          onClick={() => onChange(o.value)}
        >
          {o.icon && <o.icon size={16} aria-hidden="true" />}
          {!o.hideLabel && o.label}
        </button>
      ))}
    </div>
  );
}

export interface TabItem<T extends string> {
  id: T;
  label: string;
  icon?: LucideIcon;
  badge?: ReactNode;
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
}: {
  tabs: TabItem<T>[];
  value: T;
  onChange: (id: T) => void;
  label: string;
}) {
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {tabs.map((t) => (
        <button key={t.id} role="tab" type="button" aria-selected={value === t.id} onClick={() => onChange(t.id)}>
          {t.icon && <t.icon size={16} aria-hidden="true" />}
          {t.label}
          {t.badge}
        </button>
      ))}
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  children,
  action,
}: {
  icon: LucideIcon;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon">
        <Icon size={28} aria-hidden="true" />
      </div>
      <h3>{title}</h3>
      {children && <p className="small">{children}</p>}
      {action}
    </div>
  );
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return <span className="spinner" role="status" aria-label={label} />;
}

export function Section({
  title,
  icon: Icon,
  defaultOpen = true,
  children,
  actions,
}: {
  title: string;
  icon?: LucideIcon;
  defaultOpen?: boolean;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <details className="inspector-section" open={defaultOpen}>
      <summary>
        {Icon && <Icon size={17} aria-hidden="true" />}
        <span>{title}</span>
        {actions && (
          <span className="row" onClick={(e) => e.preventDefault()}>
            {actions}
          </span>
        )}
        <ChevronRight className="chev" size={16} aria-hidden="true" />
      </summary>
      <div className="inspector-body">{children}</div>
    </details>
  );
}

export function SearchInput({
  value,
  onChange,
  placeholder,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  label: string;
}) {
  const id = useId();
  return (
    <div className="search-input">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <Search size={16} aria-hidden="true" />
      <input
        id={id}
        className="input"
        type="search"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
      />
    </div>
  );
}

export function Field({ label, hint, error, children, htmlFor }: { label: string; hint?: string; error?: string | null; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="field">
      <label className="field-label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {error ? <span className="field-error" role="alert">{error}</span> : hint ? <span className="field-hint">{hint}</span> : null}
    </div>
  );
}
