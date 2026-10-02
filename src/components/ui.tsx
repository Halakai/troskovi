import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useData } from '../data/DataProvider';
import { addMonths, currentMonth, formatDMY, formatMonth } from '../lib/dates';
import { navigate } from '../lib/router';
import { categoryResolver, SHARED_COLOR } from '../lib/stats';
import type { Category, CategoryKind, SavingsAccount } from '../types';
import { IconBack, IconCalendar, IconClose, IconCloudOff, IconGear, IconLeft, IconRight } from './Icons';

// ---------------------------------------------------------------- lookups

export function useLookups() {
  const { categories, profiles, savingsAccounts } = useData();
  const resolve = categoryResolver(categories);
  const personById = new Map(profiles.map((p) => [p.id, p]));
  const accountById = new Map(savingsAccounts.map((a) => [a.id, a]));
  return {
    /** unknown / missing categories resolve to "Other" (or "Other income") */
    category: (id: string | null, kind: CategoryKind = 'expense'): Category | undefined => resolve(id, kind),
    account: (id: string | null): SavingsAccount | undefined => (id ? accountById.get(id) : undefined),
    personName: (id: string | null) => (id ? (personById.get(id)?.display_name ?? 'Unknown') : 'Shared'),
    personColor: (id: string | null) => (id ? (personById.get(id)?.color ?? SHARED_COLOR) : SHARED_COLOR),
  };
}

// ---------------------------------------------------------------- layout

/** Screens without a back arrow get the settings gear. */
export function TopBar({ title, back, right }: { title: ReactNode; back?: string; right?: ReactNode }) {
  const { live, pendingCount, syncError, refresh } = useData();
  return (
    <header className="topbar">
      {back && (
        <button className="icon-btn" onClick={() => navigate(back)} aria-label="Back">
          <IconBack />
        </button>
      )}
      <div className="topbar-title">{title}</div>
      <div className="topbar-right">
        {right}
        {!back && (
          <button className="icon-btn" onClick={() => navigate('/settings')} aria-label="Settings">
            <IconGear width={22} height={22} />
          </button>
        )}
        <button
          className={`sync ${live && !syncError ? 'sync-live' : 'sync-off'}`}
          onClick={() => refresh()}
          title={syncError ?? (live ? 'Live – changes appear instantly' : 'Offline')}
        >
          {pendingCount > 0 ? (
            <>
              <IconCloudOff /> {pendingCount}
            </>
          ) : (
            <span className="sync-dot" />
          )}
        </button>
      </div>
    </header>
  );
}

export function MonthSwitcher({ month, onChange }: { month: string; onChange: (m: string) => void }) {
  const now = currentMonth();
  return (
    <div className="switcher">
      <button className="icon-btn" onClick={() => onChange(addMonths(month, -1))} aria-label="Previous month">
        <IconLeft />
      </button>
      <button className="switcher-label" onClick={() => onChange(now)} title="Back to this month">
        {formatMonth(month)}
      </button>
      <button className="icon-btn" onClick={() => onChange(addMonths(month, 1))} aria-label="Next month" disabled={month >= now}>
        <IconRight />
      </button>
    </div>
  );
}

export function YearSwitcher({ year, onChange }: { year: number; onChange: (y: number) => void }) {
  const now = new Date().getFullYear();
  return (
    <div className="switcher">
      <button className="icon-btn" onClick={() => onChange(year - 1)} aria-label="Previous year">
        <IconLeft />
      </button>
      <button className="switcher-label" onClick={() => onChange(now)}>
        {year}
      </button>
      <button className="icon-btn" onClick={() => onChange(year + 1)} aria-label="Next year" disabled={year >= now}>
        <IconRight />
      </button>
    </div>
  );
}

export function Sheet({ title, onClose, children }: { title: ReactNode; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    document.body.classList.add('no-scroll');
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.classList.remove('no-scroll');
    };
  }, [onClose]);

  return createPortal(
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <IconClose />
          </button>
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------- small pieces

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: ReactNode; color?: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="seg" role="radiogroup">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          className={o.value === value ? 'seg-on' : ''}
          style={o.value === value && o.color ? { background: o.color, color: '#fff' } : undefined}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Spending against a limit (turns amber/red near and over it), or with `goal` progress towards a target. */
export function Progress({ value, max, color, goal }: { value: number; max: number; color?: string; goal?: boolean }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : value > 0 ? 100 : 0;
  const state = goal ? 'ok' : max > 0 && value > max ? 'over' : max > 0 && value > max * 0.85 ? 'near' : 'ok';
  return (
    <div className={`progress progress-${state}`}>
      <div style={{ width: `${pct}%`, ...(color && state === 'ok' ? { background: color } : {}) }} />
    </div>
  );
}

export function Avatar({ name, color, size = 32 }: { name: string; color: string; size?: number }) {
  return (
    <span className="avatar" style={{ background: color, width: size, height: size, fontSize: size * 0.45 }}>
      {name === 'Shared' ? '🤝' : name.slice(0, 1).toUpperCase()}
    </span>
  );
}

/** Emoji on a tinted square – for categories and savings accounts. */
export function CatIcon({ category, size = 40 }: { category?: Pick<Category, 'emoji' | 'color'>; size?: number }) {
  return (
    <span
      className="cat-icon"
      style={{ background: `${category?.color ?? '#64748b'}26`, width: size, height: size, fontSize: size * 0.5 }}
    >
      {category?.emoji ?? '📦'}
    </span>
  );
}

export function Donut({ segments, size = 132, children }: { segments: { value: number; color: string }[]; size?: number; children?: ReactNode }) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  const r = 52;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div className="donut" style={{ width: size, height: size }}>
      <svg viewBox="0 0 120 120" width={size} height={size}>
        <circle cx="60" cy="60" r={r} fill="none" stroke="var(--surface-2)" strokeWidth="14" />
        {total > 0 &&
          segments
            .filter((s) => s.value > 0)
            .map((s, i) => {
              const len = (s.value / total) * c;
              const el = (
                <circle
                  key={i}
                  cx="60"
                  cy="60"
                  r={r}
                  fill="none"
                  stroke={s.color}
                  strokeWidth="14"
                  strokeDasharray={`${Math.max(0, len - 1.5)} ${c}`}
                  strokeDashoffset={-offset}
                  transform="rotate(-90 60 60)"
                />
              );
              offset += len;
              return el;
            })}
      </svg>
      <div className="donut-center">{children}</div>
    </div>
  );
}

export function Empty({ emoji, title, children }: { emoji: string; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-emoji">{emoji}</div>
      <div className="empty-title">{title}</div>
      {children && <div className="empty-text">{children}</div>}
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

/**
 * Date field that always reads dd/mm/yyyy. Phones render <input type="date"> in the
 * phone's region format (often mm/dd/yyyy), so the real input sits invisibly on top of
 * our own text: tapping it still opens the phone's native calendar.
 */
export function DateInput({ value, onChange }: { value: string; onChange: (iso: string) => void }) {
  return (
    <span className="input date-input">
      <span className={value ? '' : 'dim'}>{value ? formatDMY(value) : 'dd/mm/yyyy'}</span>
      <IconCalendar />
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onClick={(e) => {
          // computers only open the calendar from its small icon; phones open it on any tap
          if (window.matchMedia('(pointer: fine)').matches) {
            try {
              e.currentTarget.showPicker();
            } catch {
              /* not supported or already open */
            }
          }
        }}
        aria-label="Date"
      />
    </span>
  );
}

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; hint?: ReactNode }) {
  return (
    <label className="toggle">
      <span>
        <span className="toggle-label">{label}</span>
        {hint && <span className="field-hint">{hint}</span>}
      </span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle-track" aria-hidden="true" />
    </label>
  );
}

export const PALETTE = [
  '#3b82f6', '#ec4899', '#22c55e', '#f97316', '#8b5cf6', '#14b8a6',
  '#eab308', '#ef4444', '#0ea5e9', '#84cc16', '#a855f7', '#64748b',
];

export function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="colors">
      {PALETTE.map((c) => (
        <button
          key={c}
          type="button"
          className={`color ${c === value ? 'color-on' : ''}`}
          style={{ background: c }}
          onClick={() => onChange(c)}
          aria-label={c}
        />
      ))}
    </div>
  );
}
