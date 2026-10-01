import { useEffect, useMemo } from 'react';
import { useData } from '../data/DataProvider';
import { monthReport, type MonthReport, type PersonStat } from '../lib/stats';
import { addMonths, formatDay, formatMonth, formatMonthShort, todayISO, WEEKDAYS, yearOf } from '../lib/dates';
import { formatMoney, percent } from '../lib/money';
import { navigate } from '../lib/router';
import type { Transaction } from '../types';
import { Avatar, CatIcon, Donut, Empty, MonthSwitcher, Progress, TopBar, useLookups } from '../components/ui';
import { TxRow } from '../components/TxRow';
import { IconRepeat } from '../components/Icons';

interface Props {
  month: string;
  setMonth: (m: string) => void;
  onOpen: (tx: Transaction) => void;
}

export function Overview({ month, setMonth, onOpen }: Props) {
  const data = useData();
  const { ensureYear } = data;

  useEffect(() => {
    ensureYear(yearOf(month));
    ensureYear(yearOf(addMonths(month, -1)));
  }, [month, ensureYear]);

  const report = useMemo(
    () =>
      monthReport(
        {
          transactions: data.allTransactions,
          categories: data.categories,
          limits: data.limits,
          recurring: data.recurring,
          profiles: data.profiles,
          today: todayISO(),
        },
        month,
      ),
    [data.allTransactions, data.categories, data.limits, data.recurring, data.profiles, month],
  );

  const recent = [...report.transactions]
    .sort((a, b) => b.date.localeCompare(a.date) || b.created_at.localeCompare(a.created_at))
    .slice(0, 5);
  const loading = data.yearLoading(yearOf(month));

  return (
    <>
      <TopBar title={<MonthSwitcher month={month} onChange={setMonth} />} />

      <Hero report={report} />

      {report.transactions.length === 0 && report.upcoming.length === 0 ? (
        <div className="card">
          {loading ? (
            <Empty emoji="⏳" title="Loading…" />
          ) : (
            <Empty emoji="🌱" title={`Nothing in ${formatMonth(month)} yet`}>
              Tap <b>+</b> to add the first expense.
            </Empty>
          )}
        </div>
      ) : (
        <>
          <MoneyFlow report={report} />
          <People report={report} />
          <Categories report={report} />
          <FunStats report={report} />
          {recent.length > 0 && (
            <section className="card">
              <div className="card-head">
                <h3>Latest</h3>
                <button className="link" onClick={() => navigate('/history')}>
                  See all
                </button>
              </div>
              {recent.map((t) => (
                <TxRow key={t.id} tx={t} onClick={() => onOpen(t)} showDate />
              ))}
            </section>
          )}
        </>
      )}
    </>
  );
}

function Hero({ report }: { report: MonthReport }) {
  const diff = report.previousSpent ? Math.round(((report.spent - report.previousSpent) / report.previousSpent) * 100) : null;
  const b = report.budget;
  return (
    <section className="card hero">
      <div className="hero-label">Spent in {formatMonthShort(report.month)}</div>
      <div className="hero-amount">{formatMoney(report.spent)}</div>
      {b && (
        <>
          <Progress value={b.spent} max={b.limit} />
          <div className="hero-sub">
            {b.spent <= b.limit ? (
              <>
                <b>{formatMoney(b.limit - b.spent, { whole: true })}</b> left of {formatMoney(b.limit, { whole: true })} budget
              </>
            ) : (
              <span className="text-danger">
                <b>{formatMoney(b.spent - b.limit, { whole: true })}</b> over the {formatMoney(b.limit, { whole: true })} budget
              </span>
            )}
          </div>
        </>
      )}
      <div className="hero-chips">
        {diff !== null && (
          <span className={`chip ${diff > 0 ? 'chip-bad' : 'chip-good'}`}>
            {diff > 0 ? '▲' : '▼'} {Math.abs(diff)}% vs {formatMonthShort(addMonths(report.month, -1))}
          </span>
        )}
        {report.projected !== null && report.projected > report.spent && (
          <span className="chip">🔮 heading for {formatMoney(report.projected, { whole: true })}</span>
        )}
      </div>
    </section>
  );
}

function MoneyFlow({ report }: { report: MonthReport }) {
  const { personName } = useLookups();
  if (!report.income && !report.expectedIncome && !report.upcoming.length) {
    return (
      <section className="card card-tip">
        💡 Add your salaries as <b>monthly income</b> (Settings → Monthly items) to see how much is left to spend each month –
        even before the second salary arrives.
      </section>
    );
  }
  return (
    <section className="card">
      <h3>Money flow</h3>
      <div className="flow">
        <div className="flow-row">
          <span>Income received</span>
          <span className="pos">{formatMoney(report.income)}</span>
        </div>
        {report.expectedIncome > 0 && (
          <div className="flow-row dim">
            <span>Still expected</span>
            <span className="pos">+{formatMoney(report.expectedIncome)}</span>
          </div>
        )}
        <div className="flow-row">
          <span>Spent</span>
          <span>−{formatMoney(report.spent)}</span>
        </div>
        {report.upcomingExpenses > 0 && (
          <div className="flow-row dim">
            <span>Bills still coming</span>
            <span>−{formatMoney(report.upcomingExpenses)}</span>
          </div>
        )}
        <div className="flow-row flow-total">
          <span>{report.isCurrent ? 'Left to spend' : 'Balance'}</span>
          <span className={report.leftToSpend < 0 ? 'text-danger' : 'pos'}>{formatMoney(report.leftToSpend, { sign: true })}</span>
        </div>
      </div>
      {report.upcoming.length > 0 && (
        <div className="upcoming">
          {report.upcoming.map(({ item, date }) => (
            <div key={item.id} className="upcoming-row">
              <IconRepeat />
              <span className="grow">
                {item.name} <span className="dim">· {personName(item.person_id)}</span>
              </span>
              <span className="dim">{formatDay(date)}</span>
              <span className={item.kind === 'income' ? 'pos' : ''}>
                {item.kind === 'income' ? '+' : '−'}
                {formatMoney(item.amount_cents, { whole: true })}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export function PeopleBlock({ people, total }: { people: PersonStat[]; total: number }) {
  const persons = people.filter((p) => p.id !== null);
  const shared = people.find((p) => p.id === null)!;
  const sorted = [...persons].sort((a, b) => b.spent - a.spent);
  const [top, second] = sorted;

  let verdict: string | null = null;
  if (top && second && top.spent + second.spent > 0) {
    const gap = top.spent - second.spent;
    verdict =
      gap < Math.max(500, total * 0.02)
        ? '🤝 Neck and neck – you spend almost exactly the same'
        : `👑 ${top.name} is the bigger spender (+${formatMoney(gap, { whole: true })})`;
  }

  return (
    <>
      <div className="stacked">
        {people
          .filter((p) => p.spent > 0)
          .map((p) => (
            <div key={p.id ?? 'shared'} style={{ flexGrow: p.spent, background: p.color }} title={p.name} />
          ))}
      </div>
      {[...sorted, shared].map((p) => (
        <div key={p.id ?? 'shared'} className="person-row">
          <Avatar name={p.name} color={p.color} />
          <span className="grow">
            <b>{p.name}</b>
            <span className="dim small">
              {' '}
              · {p.count} {p.count === 1 ? 'expense' : 'expenses'}
            </span>
          </span>
          <span className="dim small">{percent(p.spent, total)}%</span>
          <b>{formatMoney(p.spent, { whole: true })}</b>
        </div>
      ))}
      {shared.spent > 0 && persons.length > 1 && (
        <div className="fair">
          <div className="fair-title">Fair split – shared costs divided equally</div>
          {persons.map((p) => (
            <div key={p.id} className="fair-row">
              <span className="dot" style={{ background: p.color }} />
              <span className="grow">{p.name}</span>
              <span className="dim small">
                {formatMoney(p.spent, { whole: true })} + {formatMoney(shared.spent / persons.length, { whole: true })}
              </span>
              <b>{formatMoney(p.fairShare, { whole: true })}</b>
            </div>
          ))}
        </div>
      )}
      {verdict && <div className="verdict">{verdict}</div>}
    </>
  );
}

function People({ report }: { report: MonthReport }) {
  if (!report.spent) return null;
  return (
    <section className="card">
      <h3>Who spent what</h3>
      <PeopleBlock people={report.people} total={report.spent} />
    </section>
  );
}

export function CategoryList({ stats, onPick, limitLabel = '' }: { stats: MonthReport['categories']; onPick?: (id: string) => void; limitLabel?: string }) {
  return (
    <div className="cat-list">
      {stats.map((s) => (
        <button key={s.category.id} className="cat-row" onClick={() => onPick?.(s.category.id)}>
          <CatIcon category={s.category} size={36} />
          <span className="grow">
            <span className="cat-row-top">
              <span className="cat-row-name">{s.category.name}</span>
              <span>
                <b>{formatMoney(s.spent, { whole: s.spent >= 100000 })}</b>
                {s.limit !== null && <span className="dim small"> / {formatMoney(s.limit, { whole: true })}{limitLabel}</span>}
              </span>
            </span>
            {s.limit !== null ? (
              <>
                <Progress value={s.spent} max={s.limit} color={s.category.color} />
                <span className={`small ${s.spent > s.limit ? 'text-danger' : 'dim'}`}>
                  {s.spent > s.limit
                    ? `${formatMoney(s.spent - s.limit, { whole: true })} over limit`
                    : `${formatMoney(s.limit - s.spent, { whole: true })} left`}
                </span>
              </>
            ) : (
              <span className="small dim">
                {s.count} × · no limit
              </span>
            )}
          </span>
        </button>
      ))}
    </div>
  );
}

function Categories({ report }: { report: MonthReport }) {
  const spentCats = report.categories.filter((c) => c.spent > 0);
  if (!report.categories.length) return null;
  const top = spentCats[0];
  return (
    <section className="card">
      <h3>Categories</h3>
      {spentCats.length > 0 && (
        <div className="donut-wrap">
          <Donut segments={spentCats.map((c) => ({ value: c.spent, color: c.category.color }))}>
            <div className="donut-emoji">{top.category.emoji}</div>
            <div className="small dim">{percent(top.spent, report.spent)}%</div>
          </Donut>
          <div className="legend">
            {spentCats.slice(0, 5).map((c) => (
              <div key={c.category.id} className="legend-row">
                <span className="dot" style={{ background: c.category.color }} />
                <span className="grow">{c.category.name}</span>
                <span className="dim small">{percent(c.spent, report.spent)}%</span>
              </div>
            ))}
          </div>
        </div>
      )}
      <CategoryList stats={report.categories} onPick={(id) => navigate(`/history?cat=${id}`)} />
    </section>
  );
}

function FunStats({ report }: { report: MonthReport }) {
  const { category, personName } = useLookups();
  const stats: { emoji: string; label: string; value: string; sub?: string }[] = [];

  if (report.daysElapsed > 0) {
    stats.push({ emoji: '📅', label: 'Daily average', value: formatMoney(report.dailyAverage), sub: 'without monthly bills' });
  }
  if (report.biggest) {
    const b = report.biggest;
    stats.push({
      emoji: '💸',
      label: 'Biggest expense',
      value: formatMoney(b.amount_cents, { whole: true }),
      sub: `${category(b.category_id)?.name ?? 'Other'} · ${personName(b.person_id)}`,
    });
  }
  if (report.daysElapsed > 0) {
    stats.push({
      emoji: report.noSpendDays >= 5 ? '🧘' : '🛍️',
      label: 'No-spend days',
      value: String(report.noSpendDays),
      sub: `of ${report.daysElapsed} ${report.daysElapsed === 1 ? 'day' : 'days'}`,
    });
  }
  if (report.busiestWeekday) {
    stats.push({
      emoji: '📆',
      label: 'Priciest weekday',
      value: WEEKDAYS[report.busiestWeekday.day],
      sub: formatMoney(report.busiestWeekday.amount, { whole: true }),
    });
  }
  if (report.mostFrequent && report.mostFrequent.count > 1) {
    stats.push({
      emoji: report.mostFrequent.category.emoji,
      label: 'Most frequent',
      value: `${report.mostFrequent.count}×`,
      sub: report.mostFrequent.category.name,
    });
  }
  if (report.projected !== null && report.daysElapsed < report.daysInMonth) {
    stats.push({
      emoji: '🔮',
      label: 'Month-end forecast',
      value: formatMoney(report.projected, { whole: true }),
      sub: 'at the current pace',
    });
  }
  if (!stats.length) return null;

  return (
    <section className="card">
      <h3>Fun facts</h3>
      <div className="stat-grid">
        {stats.map((s) => (
          <div key={s.label} className="stat">
            <div className="stat-emoji">{s.emoji}</div>
            <div className="stat-label">{s.label}</div>
            <div className="stat-value">{s.value}</div>
            {s.sub && <div className="stat-sub">{s.sub}</div>}
          </div>
        ))}
      </div>
    </section>
  );
}
