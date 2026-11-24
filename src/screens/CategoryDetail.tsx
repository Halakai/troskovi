import { useEffect, useMemo, useState } from 'react';
import { useData, useReportInput } from '../data/DataProvider';
import { categoryTrend, monthReport } from '../lib/stats';
import { addMonths, currentMonth, formatMonth, formatMonthShort, monthOf, yearOf } from '../lib/dates';
import { formatMoney, percent } from '../lib/money';
import { navigate } from '../lib/router';
import { CatIcon, Empty, Progress, TopBar } from '../components/ui';
import { CategoryList } from '../components/report';

interface Props {
  params: URLSearchParams;
  /** the month the app is looking at – picked first */
  viewMonth: string;
  setMonth: (m: string) => void;
}

/** One category over the last 12 months, with its subcategories. */
export function CategoryDetail({ params, viewMonth, setMonth }: Props) {
  const data = useData();
  const { ensureYear } = data;
  const id = params.get('id') ?? '';
  const back = params.get('from') ?? '/';
  const cat = data.categories.find((c) => c.id === id);
  const main = cat?.parent_id ? data.categories.find((c) => c.id === cat.parent_id) : undefined;
  const subs = data.categories.filter((c) => c.parent_id === id);

  const now = currentMonth();
  const end = viewMonth > now ? viewMonth : now;
  // up to 12 months, but not before the first entry ever (empty months before tracking say nothing)
  const firstMonth = data.firstDate ? monthOf(data.firstDate) : now;
  const months = useMemo(() => {
    const list = Array.from({ length: 12 }, (_, i) => addMonths(end, i - 11));
    const tracked = list.filter((m) => m >= firstMonth);
    return tracked.length ? tracked : [end];
  }, [end, firstMonth]);
  const [selected, setSelected] = useState(viewMonth);

  useEffect(() => {
    for (let y = yearOf(months[0]); y <= yearOf(end); y++) ensureYear(y);
  }, [months, end, ensureYear]);

  const input = useReportInput();
  const trend = useMemo(() => categoryTrend(input, id, months), [input, id, months]);
  const report = useMemo(() => monthReport(input, selected), [input, selected]);

  if (!cat) {
    return (
      <>
        <TopBar title="Category" back={back} />
        <div className="card">
          <Empty emoji="🤷" title="This category doesn't exist anymore" />
        </div>
      </>
    );
  }

  const isIncome = cat.kind === 'income';
  const color = main?.color ?? cat.color;
  const point = trend.find((p) => p.month === selected) ?? { month: selected, spent: 0, count: 0, limit: null };
  // average over finished months (this one isn't over yet), from the first month this category was used
  const firstUsed = trend.find((p) => p.count > 0)?.month ?? now;
  const finished = trend.filter((p) => p.month >= firstUsed && p.month < now);
  const average = finished.length ? Math.round(finished.reduce((s, p) => s + p.spent, 0) / finished.length) : null;
  const vsAverage = average && selected < now ? Math.round(((point.spent - average) / average) * 100) : null;
  const max = Math.max(1, ...trend.map((p) => Math.max(p.spent, p.limit ?? 0)));
  const tracked = [...trend].reverse();
  const shortLabels = trend.length > 8;

  const stats = isIncome ? report.incomeCategories : report.categories;
  const subStats = stats.find((s) => s.category.id === id)?.subs ?? [];

  return (
    <>
      <TopBar
        title={
          <span className="title-cat">
            <CatIcon category={{ emoji: cat.emoji, color }} size={30} />
            <span className="title-cat-name">{cat.name}</span>
          </span>
        }
        back={back}
      />

      <section className="card hero">
        <div className="hero-label">
          {isIncome ? 'Received' : 'Spent'} in {formatMonth(selected)}
          {main && ` · part of ${main.name}`}
        </div>
        <div className="hero-amount">{formatMoney(point.spent)}</div>
        {point.limit !== null && (
          <>
            <Progress value={point.spent} max={point.limit} color={color} />
            <div className="hero-sub">
              {point.spent <= point.limit ? (
                <>
                  <b>{formatMoney(point.limit - point.spent, { whole: true })}</b> left of the {formatMoney(point.limit, { whole: true })} limit
                </>
              ) : (
                <span className="text-danger">
                  <b>{formatMoney(point.spent - point.limit, { whole: true })}</b> over the {formatMoney(point.limit, { whole: true })} limit
                </span>
              )}
            </div>
          </>
        )}
        <div className="hero-chips">
          <span className="chip">
            {point.count} {point.count === 1 ? 'entry' : 'entries'}
          </span>
          {!isIncome && point.spent > 0 && report.spent > 0 && (
            <span className="chip">{percent(point.spent, report.spent)}% of all spending</span>
          )}
          {average !== null && <span className="chip">⌀ {formatMoney(average, { whole: true })} / month</span>}
          {vsAverage !== null && vsAverage !== 0 && (
            <span className={`chip ${(vsAverage > 0) !== isIncome ? 'chip-bad' : 'chip-good'}`}>
              {vsAverage > 0 ? '▲' : '▼'} {Math.abs(vsAverage)}% vs average
            </span>
          )}
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h3>{trend.length === 12 ? 'Last 12 months' : `Since ${formatMonth(trend[0].month)}`}</h3>
          <span className="small dim">tap a month</span>
        </div>
        <div className="trend" style={{ gridTemplateColumns: `repeat(${trend.length}, 1fr)` }}>
          {trend.map((p) => (
            <button
              key={p.month}
              className={`trend-col ${p.month === selected ? 'trend-col-on' : ''}`}
              onClick={() => setSelected(p.month)}
              aria-label={`${formatMonth(p.month)}: ${formatMoney(p.spent)}`}
              aria-pressed={p.month === selected}
            >
              <span className="trend-plot">
                {p.spent > 0 && <span className="trend-bar" style={{ height: `${(p.spent / max) * 100}%`, background: color }} />}
                {p.limit !== null && <span className="trend-limit" style={{ bottom: `${(p.limit / max) * 100}%` }} />}
              </span>
              <span className="trend-label">{shortLabels ? formatMonthShort(p.month).slice(0, 1) : formatMonthShort(p.month)}</span>
            </button>
          ))}
        </div>
        {trend.some((p) => p.limit !== null) && (
          <div className="bars-legend">
            <span>
              <span className="trend-limit-key" /> monthly limit
            </span>
          </div>
        )}
      </section>

      {subs.length > 0 && (
        <section className="card">
          <h3>Subcategories in {formatMonthShort(selected)}</h3>
          {subStats.length ? (
            <CategoryList stats={subStats} onPick={(sid) => sid !== id && navigate(`/category?id=${sid}&from=${encodeURIComponent(back)}`)} />
          ) : (
            <p className="small dim">Nothing in {formatMonth(selected)}.</p>
          )}
        </section>
      )}

      <section className="card">
        <h3>Month by month</h3>
        <div className="month-table">
          {tracked.map((p) => (
            <button key={p.month} className={`month-row ${p.month === selected ? 'month-row-on' : ''}`} onClick={() => setSelected(p.month)}>
              <span className="grow">{formatMonth(p.month)}</span>
              <span className="dim small">{p.count}×</span>
              <b className={p.limit !== null && p.spent > p.limit ? 'text-danger' : ''}>{formatMoney(p.spent)}</b>
              {p.limit !== null && <span className="dim small">/ {formatMoney(p.limit, { whole: true })}</span>}
            </button>
          ))}
        </div>
      </section>

      <button
        className="btn btn-ghost btn-block"
        onClick={() => {
          setMonth(selected);
          navigate(`/history?cat=${id}`);
        }}
      >
        Show {formatMonthShort(selected)} entries in History
      </button>
    </>
  );
}
