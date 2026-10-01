import { useEffect, useMemo } from 'react';
import { useData } from '../data/DataProvider';
import { formatDayHeading, formatMonth, monthOf, yearOf } from '../lib/dates';
import { formatMoney } from '../lib/money';
import { navigate } from '../lib/router';
import type { Transaction } from '../types';
import { Empty, MonthSwitcher, TopBar } from '../components/ui';
import { TxRow } from '../components/TxRow';

interface Props {
  month: string;
  setMonth: (m: string) => void;
  params: URLSearchParams;
  onOpen: (tx: Transaction) => void;
}

export function History({ month, setMonth, params, onOpen }: Props) {
  const data = useData();
  const { ensureYear } = data;
  const who = params.get('who') ?? 'all';
  const kind = params.get('kind') ?? 'all';
  const cat = params.get('cat') ?? 'all';

  useEffect(() => ensureYear(yearOf(month)), [month, ensureYear]);

  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value === 'all') next.delete(key);
    else next.set(key, value);
    const q = next.toString();
    navigate(`/history${q ? `?${q}` : ''}`);
  };

  const people = data.profiles.filter((p) => p.active).sort((a, b) => a.created_at.localeCompare(b.created_at));
  const other = data.categories.find((c) => c.is_system);

  const filtered = useMemo(
    () =>
      data.allTransactions
        .filter((t) => monthOf(t.date) === month)
        .filter((t) => who === 'all' || (who === 'shared' ? t.person_id === null : t.person_id === who))
        .filter((t) => kind === 'all' || t.kind === kind)
        .filter((t) => cat === 'all' || (t.kind === 'expense' && (t.category_id ?? other?.id) === cat))
        .sort((a, b) => b.date.localeCompare(a.date) || b.created_at.localeCompare(a.created_at)),
    [data.allTransactions, month, who, kind, cat, other?.id],
  );

  const days = useMemo(() => {
    const groups: { date: string; items: Transaction[]; spent: number }[] = [];
    for (const t of filtered) {
      let g = groups[groups.length - 1];
      if (!g || g.date !== t.date) groups.push((g = { date: t.date, items: [], spent: 0 }));
      g.items.push(t);
      if (t.kind === 'expense') g.spent += t.amount_cents;
    }
    return groups;
  }, [filtered]);

  const spent = filtered.filter((t) => t.kind === 'expense').reduce((s, t) => s + t.amount_cents, 0);
  const income = filtered.filter((t) => t.kind === 'income').reduce((s, t) => s + t.amount_cents, 0);
  const filtering = who !== 'all' || kind !== 'all' || cat !== 'all';

  return (
    <>
      <TopBar title={<MonthSwitcher month={month} onChange={setMonth} />} />

      <div className="filters">
        <div className="chips-scroll">
          {[{ id: 'all', name: 'Everyone' }, ...people.map((p) => ({ id: p.id, name: p.display_name })), { id: 'shared', name: '🤝 Shared' }].map(
            (p) => (
              <button key={p.id} className={`chip ${who === p.id ? 'chip-on' : ''}`} onClick={() => setFilter('who', p.id)}>
                {p.name}
              </button>
            ),
          )}
        </div>
        <div className="filters-row">
          <select className="input input-sm" value={kind} onChange={(e) => setFilter('kind', e.target.value)}>
            <option value="all">Expenses & income</option>
            <option value="expense">Expenses only</option>
            <option value="income">Income only</option>
          </select>
          <select className="input input-sm" value={cat} onChange={(e) => setFilter('cat', e.target.value)}>
            <option value="all">All categories</option>
            {data.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.emoji} {c.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="summary-line">
        <span>
          {filtered.length} {filtered.length === 1 ? 'entry' : 'entries'}
          {filtering && (
            <button className="link" onClick={() => navigate('/history')}>
              {' '}
              · clear filters
            </button>
          )}
        </span>
        <span>
          {spent > 0 && <b>−{formatMoney(spent)}</b>}
          {income > 0 && <b className="pos"> +{formatMoney(income)}</b>}
        </span>
      </div>

      {days.length === 0 ? (
        <div className="card">
          {data.yearLoading(yearOf(month)) ? (
            <Empty emoji="⏳" title="Loading…" />
          ) : (
            <Empty emoji="🔍" title={filtering ? 'Nothing matches these filters' : `Nothing in ${formatMonth(month)}`} />
          )}
        </div>
      ) : (
        days.map((d) => (
          <section key={d.date} className="card day">
            <div className="day-head">
              <span>{formatDayHeading(d.date)}</span>
              {d.spent > 0 && <span>−{formatMoney(d.spent)}</span>}
            </div>
            {d.items.map((t) => (
              <TxRow key={t.id} tx={t} onClick={() => onOpen(t)} />
            ))}
          </section>
        ))
      )}
    </>
  );
}
