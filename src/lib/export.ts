// Turning the data into files to keep, and handing them to the phone or computer.
import type { ExportData } from '../data/DataProvider';

const CRLF = String.fromCharCode(13, 10);
const BOM = String.fromCharCode(0xfeff); // lets Excel see the file is UTF-8 (č, ć, š, ž, đ)

const TYPE = { expense: 'Expense', income: 'Income', saving: 'Savings' } as const;

/** One CSV field: quoted when it holds a comma, a quote or a line break. */
function field(value: string): string {
  const needsQuotes = [',', '"', String.fromCharCode(10), String.fromCharCode(13)].some((ch) => value.includes(ch));
  return needsQuotes ? `"${value.split('"').join('""')}"` : value;
}

/**
 * Every entry as a CSV table (oldest first). Dates are YYYY-MM-DD and amounts use a dot,
 * so the file reads the same everywhere (Excel, Google Sheets, Python/pandas).
 */
export function entriesCsv(d: ExportData): string {
  const categories = new Map(d.categories.map((c) => [c.id, c]));
  const accounts = new Map(d.savingsAccounts.map((a) => [a.id, a]));
  const people = new Map(d.profiles.map((p) => [p.id, p.display_name]));
  const monthly = new Map(d.recurring.map((r) => [r.id, r.name]));
  const other = (kind: 'expense' | 'income') => d.categories.find((c) => c.is_system && c.kind === kind)?.name ?? 'Other';

  const header = ['Date', 'Type', 'Amount', 'Category', 'Subcategory', 'Savings account', 'Person', 'Note', 'Monthly item', 'Added by', 'Added at'];
  const rows = [...d.transactions]
    .sort((a, b) => a.date.localeCompare(b.date) || a.created_at.localeCompare(b.created_at))
    .map((t) => {
      let main = '';
      let sub = '';
      if (t.kind !== 'saving') {
        const c = t.category_id ? categories.get(t.category_id) : undefined;
        const parent = c?.parent_id ? categories.get(c.parent_id) : undefined;
        if (!c || c.kind !== t.kind) main = other(t.kind);
        else if (parent) [main, sub] = [parent.name, c.name];
        else main = c.name;
      }
      return [
        t.date,
        TYPE[t.kind],
        (t.amount_cents / 100).toFixed(2),
        main,
        sub,
        t.kind === 'saving' ? (accounts.get(t.savings_account_id ?? '')?.name ?? '') : '',
        t.person_id ? (people.get(t.person_id) ?? 'Unknown') : 'Shared',
        t.note ?? '',
        t.recurring_id ? (monthly.get(t.recurring_id) ?? 'yes') : '',
        people.get(t.created_by) ?? '',
        t.created_at,
      ];
    });
  return BOM + [header, ...rows].map((r) => r.map(field).join(',')).join(CRLF) + CRLF;
}

/** Everything in one file. */
export function backupJson(d: ExportData): string {
  return JSON.stringify({ app: 'troskovi', version: 1, ...d }, null, 2);
}

/**
 * Phones get the share sheet ("Save to Files", Drive, mail…); computers – or phones that
 * can't share this kind of file – get a normal download.
 * Must be called straight from a tap: iPhones only allow sharing right after one.
 */
export async function saveFile(name: string, type: string, content: string): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const blob = new Blob([content], { type });
  const file = new File([blob], name, { type });
  const touch = window.matchMedia('(pointer: coarse)').matches;
  if (touch && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name });
      return 'shared';
    } catch (e) {
      if ((e as DOMException)?.name === 'AbortError') return 'cancelled';
      // not allowed here – fall back to a download
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return 'downloaded';
}
