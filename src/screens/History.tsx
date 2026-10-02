import { useEffect, useMemo } from 'react';
import { useData } from '../data/DataProvider';
import { formatDayHeading, formatMonth, monthOf, yearOf } from '../lib/dates';
import { formatMoney } from '../lib/money';
import { navigate } from '../lib/router';
import { categoryResolver } from '../lib/stats';
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
    if (key === 'kind') next.delete('cat'); // categories differ per type
    const q = next.toString();
    navigate(`/history${q ? `?${q}` : ''}`);
  };

  const people = data.profiles.filter((p) => p.active).sort((a, b) => a.created_at.localeCompare(b.created_at));
  const expenseCats = data.categories.filter((c) => c.kind === 'expense');
  const incomeCats = data.categories.filter((c) => c.kind === 'income');

  const filtered = useMemo(() => {
    const resolve = categoryResolver(data.categories);
    const matchesCat = (t: Transaction) => {
      if (cat === 'all') return true;
      if (cat.startsWith('acc:')) return t.kind === 'saving' && t.savings_account_id === cat.slice(4);
      if (t.kind === 'saving') return false;
      return resolve(t.category_id, t.kind)?.id === cat;
    };
    return data.allTransactions
      .filter((t) => monthOf(t.date) === month)
      .filter((t) => who === 'all' || (who === 'shared' ? t.person_id === null : t.person_id === who))
      .filter((t) => kind === 'all' || t.kind === kind)
      .filter(matchesCat)
      .sort((a, b) => b.date.localeCompare(a.date) || b.created_at.localeCompare(a.created_at));
  }, [data.allTransactions, data.categories, month, who, kind, cat]);

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

  const total = (k: Transaction['kind']) => filtered.filter((t) => t.kind === k).reduce((s, t) => s + t.amount_cents, 0);
  const spent = total('expense');
  const income = total('income');
  const saved = total('saving');
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
            <option value="all">All entries</option>
            <option value="expense">Expenses</option>
            <option value="income">Income</option>
            <option value="saving">Savings</option>
          </select>
          <select className="input input-sm" value={cat} onChange={(e) => setFilter('cat', e.target.value)}>
            <option value="all">{kind === 'saving' ? 'All accounts' : 'All categories'}</option>
            {(kind === 'all' || kind === 'expense') && (
              <optgroup label="Expense categories">
                {expenseCats.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.emoji} {c.name}
                  </option>
                ))}
              </optgroup>
            )}
            {(kind === 'all' || kind === 'income') && (
              <optgroup label="Income categories">
                {incomeCats.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.emoji} {c.name}
                  </option>
                ))}
              </optgroup>
            )}
            {(kind === 'all' || kind === 'saving') && data.savingsAccounts.length > 0 && (
              <optgroup label="Savings accounts">
                {data.savingsAccounts.map((a) => (
                  <option key={a.id} value={`acc:${a.id}`}>
                    {a.emoji} {a.name}
                  </option>
                ))}
              </optgroup>
            )}
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
          {saved !== 0 && (
            <b className="save">
              {' '}
              🐷 {saved > 0 ? '+' : '−'}
              {formatMoney(Math.abs(saved))}
            </b>
          )}
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
