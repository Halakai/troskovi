import { CURRENCY, LOCALE } from '../config';

const full = new Intl.NumberFormat(LOCALE, { style: 'currency', currency: CURRENCY });
const whole = new Intl.NumberFormat(LOCALE, { style: 'currency', currency: CURRENCY, maximumFractionDigits: 0 });

/** 123456 → "€1,234.56" */
export function formatMoney(cents: number, opts: { whole?: boolean; sign?: boolean } = {}): string {
  const value = cents / 100;
  const text = (opts.whole ? whole : full).format(Math.abs(value));
  if (value < 0) return `−${text}`;
  if (opts.sign && value > 0) return `+${text}`;
  return text;
}

/** For pre-filling inputs: 1250 → "12.50", 1200 → "12" */
export function centsToInput(cents: number): string {
  return cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2);
}

/**
 * Parses what people type on a phone keyboard into cents.
 * Accepts "12", "12.5", "12,50", "1.234,56", "1,234.56", "€ 12".
 * Returns null for anything that isn't a positive amount.
 */
export function parseAmount(input: string): number | null {
  let s = input.replace(/[\s€]/g, '');
  if (!s) return null;
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  // "1.234.567" → "1234567"; groups after the first must have exactly 3 digits
  const dropThousands = (int: string, sep: string) => {
    const groups = int.split(sep);
    return groups.slice(1).every((g) => g.length === 3) ? groups.join('') : null;
  };
  let normalized: string | null = s;
  if (lastDot >= 0 && lastComma >= 0) {
    // both present: whichever comes last is the decimal separator
    const dec = lastDot > lastComma ? '.' : ',';
    const parts = s.split(dec);
    const int = parts.length === 2 ? dropThousands(parts[0], dec === '.' ? ',' : '.') : null;
    normalized = int === null ? null : `${int}.${parts[1]}`;
  } else if (lastComma >= 0 || lastDot >= 0) {
    const sep = lastComma >= 0 ? ',' : '.';
    const parts = s.split(sep);
    // "12,5" / "12.50" → decimal;  "1.234" / "1,234,567" → thousands
    normalized = parts.length === 2 && parts[1].length <= 2 ? parts.join('.') : dropThousands(s, sep);
  }
  if (normalized === null || !/^\d+(\.\d{0,2})?$/.test(normalized)) return null;
  s = normalized;
  const cents = Math.round(parseFloat(s) * 100);
  return cents > 0 ? cents : null;
}

export function percent(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}
