import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { roundTo, type Vec3 } from '../engine/core/math';

/**
 * Numeric field with a draggable label ("scrubbing"): drag the coloured
 * label left/right with a finger or mouse to change the value, or type a
 * number. Changes commit on Enter/blur, so typing is never interrupted.
 */
export function NumberField({
  value,
  onChange,
  onScrubEnd,
  label,
  color,
  step = 0.1,
  min = -Infinity,
  max = Infinity,
  precision = 3,
  ariaLabel,
  disabled,
}: {
  value: number;
  onChange: (value: number, scrubbing: boolean) => void;
  onScrubEnd?: () => void;
  label?: string;
  color?: string;
  step?: number;
  min?: number;
  max?: number;
  precision?: number;
  ariaLabel: string;
  disabled?: boolean;
}) {
  const [text, setText] = useState(() => format(value, precision));
  const [editing, setEditing] = useState(false);
  const scrub = useRef<{ x: number; start: number; moved: boolean } | null>(null);

  useEffect(() => {
    if (!editing) setText(format(value, precision));
  }, [value, precision, editing]);

  const clampValue = (v: number) => Math.min(max, Math.max(min, v));

  const commit = () => {
    setEditing(false);
    const parsed = evaluate(text);
    if (parsed === null) {
      setText(format(value, precision));
      return;
    }
    const v = clampValue(roundTo(parsed, precision));
    if (v !== value) onChange(v, false);
    setText(format(v, precision));
  };

  return (
    <div className="num-field">
      {label && (
        <span
          className="num-label"
          style={{ background: color ?? 'var(--surface-3)', color: color ? '#fff' : 'var(--text-muted)' } as CSSProperties}
          aria-hidden="true"
          onPointerDown={(e) => {
            if (disabled) return;
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
            scrub.current = { x: e.clientX, start: value, moved: false };
          }}
          onPointerMove={(e) => {
            const s = scrub.current;
            if (!s) return;
            const dx = e.clientX - s.x;
            if (Math.abs(dx) > 2) s.moved = true;
            if (!s.moved) return;
            const factor = e.shiftKey ? 0.1 : 1;
            onChange(clampValue(roundTo(s.start + Math.round(dx / 4) * step * factor, precision)), true);
          }}
          onPointerUp={() => {
            if (scrub.current?.moved) onScrubEnd?.();
            scrub.current = null;
          }}
          onPointerCancel={() => {
            if (scrub.current?.moved) onScrubEnd?.();
            scrub.current = null;
          }}
        >
          {label}
        </span>
      )}
      <input
        type="text"
        inputMode="decimal"
        aria-label={ariaLabel}
        value={text}
        disabled={disabled}
        onFocus={(e) => {
          setEditing(true);
          e.target.select();
        }}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') {
            setText(format(value, precision));
            setEditing(false);
            (e.target as HTMLInputElement).blur();
          }
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const v = clampValue(roundTo(value + (e.key === 'ArrowUp' ? step : -step), precision));
            onChange(v, false);
            setText(format(v, precision));
          }
        }}
      />
    </div>
  );
}

function format(v: number, precision: number): string {
  return String(roundTo(v, precision));
}

/** Accepts plain numbers and simple arithmetic like "2*3" or "10/4" (no eval). */
export function evaluate(text: string): number | null {
  const t = text.replace(/,/g, '.').replace(/\s+/g, '');
  if (!t) return null;
  if (/^[-+]?\d*\.?\d+(e[-+]?\d+)?$/i.test(t)) return Number(t);
  const m = /^([-+]?\d*\.?\d+)([+\-*/])([-+]?\d*\.?\d+)$/.exec(t);
  if (!m) return null;
  const a = Number(m[1]);
  const b = Number(m[3]);
  switch (m[2]) {
    case '+':
      return a + b;
    case '-':
      return a - b;
    case '*':
      return a * b;
    case '/':
      return b === 0 ? null : a / b;
  }
  return null;
}

const AXIS_COLORS = ['var(--axis-x)', 'var(--axis-y)', 'var(--axis-z)'];

export function Vec3Field({
  value,
  onChange,
  onScrubEnd,
  step = 0.1,
  precision = 3,
  ariaLabel,
  disabled,
  min,
}: {
  value: Vec3;
  onChange: (value: Vec3, scrubbing: boolean) => void;
  onScrubEnd?: () => void;
  step?: number;
  precision?: number;
  ariaLabel: string;
  disabled?: boolean;
  min?: number;
}) {
  return (
    <div className="vec3" role="group" aria-label={ariaLabel}>
      {(['X', 'Y', 'Z'] as const).map((axis, i) => (
        <NumberField
          key={axis}
          label={axis}
          color={AXIS_COLORS[i]}
          value={value[i] as number}
          step={step}
          precision={precision}
          min={min}
          disabled={disabled}
          ariaLabel={`${ariaLabel} ${axis}`}
          onScrubEnd={onScrubEnd}
          onChange={(v, scrubbing) => {
            const next: Vec3 = [...value];
            next[i] = v;
            onChange(next, scrubbing);
          }}
        />
      ))}
    </div>
  );
}

export const COLOR_SWATCHES = [
  '#f5f7fb', '#a3a7ad', '#3a3f4b', '#e5484d', '#ff8a1f', '#ffcf3d', '#7bd389', '#30a46c',
  '#2bb3a3', '#4f8cff', '#3e63dd', '#7b5cff', '#ff5d8f', '#8b5a2b',
];

export function ColorField({
  value,
  onChange,
  ariaLabel,
  swatches = true,
  disabled,
}: {
  value: string;
  onChange: (color: string, live: boolean) => void;
  ariaLabel: string;
  swatches?: boolean;
  disabled?: boolean;
}) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <div className="prop-stack">
      <div className="color-field">
        <input type="color" aria-label={ariaLabel} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value, true)} />
        <input
          className="input mono"
          aria-label={`${ariaLabel} hex code`}
          value={text}
          disabled={disabled}
          maxLength={7}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => {
            const v = text.startsWith('#') ? text : `#${text}`;
            if (/^#[0-9a-fA-F]{6}$/.test(v)) onChange(v.toLowerCase(), false);
            else setText(value);
          }}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
      </div>
      {swatches && (
        <div className="swatches" role="group" aria-label={`${ariaLabel} presets`}>
          {COLOR_SWATCHES.map((c) => (
            <button
              key={c}
              type="button"
              className="swatch"
              style={{ background: c }}
              aria-label={`Use colour ${c}`}
              aria-pressed={value.toLowerCase() === c}
              disabled={disabled}
              onClick={() => onChange(c, false)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function SliderField({
  value,
  onChange,
  min,
  max,
  step,
  ariaLabel,
  disabled,
}: {
  value: number;
  onChange: (v: number, live: boolean) => void;
  min: number;
  max: number;
  step: number;
  ariaLabel: string;
  disabled?: boolean;
}) {
  return (
    <div className="slider-row">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={ariaLabel}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value), true)}
      />
      <NumberField value={value} min={min} max={max} step={step} precision={3} ariaLabel={`${ariaLabel} value`} disabled={disabled} onChange={(v) => onChange(v, false)} />
    </div>
  );
}

export function SelectField<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  disabled,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  ariaLabel: string;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <select id={id} className="select" value={value} aria-label={ariaLabel} disabled={disabled} onChange={(e) => onChange(e.target.value as T)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/** Text input that commits on blur/Enter (avoids one undo step per keystroke). */
export function CommitTextField({
  value,
  onCommit,
  ariaLabel,
  placeholder,
  maxLength = 64,
  disabled,
}: {
  value: string;
  onCommit: (v: string) => void;
  ariaLabel: string;
  placeholder?: string;
  maxLength?: number;
  disabled?: boolean;
}) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <input
      className="input"
      aria-label={ariaLabel}
      value={text}
      placeholder={placeholder}
      maxLength={maxLength}
      disabled={disabled}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        if (text.trim() && text !== value) onCommit(text);
        else setText(value);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') {
          setText(value);
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}
