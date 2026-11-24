// Everything about one month, one topic at a time. The home page only shows the essentials and links here.
import { useMonthReport } from '../data/useMonthReport';
import type { MonthReport } from '../lib/stats';
import { addMonths, formatMonth, formatMonthShort, WEEKDAYS } from '../lib/dates';
import { formatMoney, percent } from '../lib/money';
import { navigate } from '../lib/router';
import { CategoryList, PeopleBlock } from '../components/report';
import { CatIcon, Donut, Empty, MonthSwitcher, Progress, Segmented, TopBar, useLookups } from '../components/ui';
import { IconClock } from '../components/Icons';

export type MonthTab = 'spending' | 'people' | 'income' | 'savings' | 'facts';

const TABS: { value: MonthTab; label: string }[] = [
  { value: 'spending', label: 'Spending' },
  { value: 'people', label: 'People' },
  { value: 'income', label: 'Income' },
  { value: 'savings', label: 'Savings' },
  { value: 'facts', label: 'Facts' },
];

/** categories opened from here lead back here */
const fromHere = (tab: MonthTab) => `&from=${encodeURIComponent(`/month?tab=${tab}`)}`;

export function MonthDetail({ month, setMonth, params }: { month: string; setMonth: (m: string) => void; params: URLSearchParams }) {
  const { report, loading } = useMonthReport(month);
  const tab = TABS.find((t) => t.value === params.get('tab'))?.value ?? 'spending';
  const name = formatMonth(month);

  const nothing = (emoji: string, title: string) => (
    <div className="card">{loading ? <Empty emoji="⏳" title="Loading…" /> : <Empty emoji={emoji} title={title} />}</div>
  );
  const content = {
    spending: () => (
      <>
        <Hero report={report} />
        <Categories report={report} />
      </>
    ),
    people: () => (report.spent ? <People report={report} /> : nothing('👥', `Nothing spent in ${name}`)),
    income: () => (report.income ? <Income report={report} /> : nothing('💼', `No income in ${name}`)),
    savings: () => (report.saved || report.upcomingSavings ? <Savings report={report} /> : nothing('🐷', `No savings in ${name}`)),
    facts: () => (report.spent ? <FunFacts report={report} /> : nothing('🎲', `Nothing to tell about ${name} yet`)),
  }[tab];

  return (
    <>
      <TopBar title={<MonthSwitcher month={month} onChange={setMonth} />} back="/" />
      <div className="tabs seg-small">
        <Segmented<MonthTab> value={tab} onChange={(t) => navigate(`/month?tab=${t}`, { replace: true })} options={TABS} />
      </div>
      {content()}
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
        {diff !== null && !report.isFuture && (
          <span className={`chip ${diff > 0 ? 'chip-bad' : 'chip-good'}`}>
            {diff > 0 ? '▲' : '▼'} {Math.abs(diff)}% vs {formatMonthShort(addMonths(report.month, -1))}
          </span>
        )}
        {report.projected !== null && report.projected > report.spent && (
          <span className="chip">🔮 heading for {formatMoney(report.projected, { whole: true })}</span>
        )}
        {report.plannedExpenses > 0 && (
          <span className="chip">
            <IconClock /> {formatMoney(report.plannedExpenses, { whole: true })} planned
          </span>
        )}
      </div>
    </section>
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
      <CategoryList stats={report.categories} onPick={(id) => navigate(`/category?id=${id}${fromHere('spending')}`)} />
    </section>
  );
}

function Income({ report }: { report: MonthReport }) {
  if (!report.income) return null;
  return (
    <section className="card">
      <div className="card-head">
        <h3>Income</h3>
        <span className="pos small">+{formatMoney(report.income, { whole: true })}</span>
      </div>
      <CategoryList stats={report.incomeCategories} onPick={(id) => navigate(`/category?id=${id}${fromHere('income')}`)} />
    </section>
  );
}

function Savings({ report }: { report: MonthReport }) {
  const morePlanned = report.upcomingSavings;
  if (!report.saved && !morePlanned) return null;
  return (
    <section className="card">
      <div className="card-head">
        <h3>Savings</h3>
        <button className="link" onClick={() => navigate('/savings')}>
          Open savings
        </button>
      </div>
      <div className="cat-list">
        {report.savings.map(({ account, net }) => (
          <button key={account.id} className="cat-row" onClick={() => navigate('/savings')}>
            <CatIcon category={account} size={36} />
            <span className="grow cat-row-name">{account.name}</span>
            <b className="save">
              {net > 0 ? '+' : '−'}
              {formatMoney(Math.abs(net))}
            </b>
          </button>
        ))}
      </div>
      {morePlanned > 0 && <p className="small dim">+{formatMoney(morePlanned)} more planned this month</p>}
      {report.saved > 0 && report.income > 0 && (
        <div className="verdict">🐷 {percent(report.saved, report.income)}% of this month's income went into savings</div>
      )}
    </section>
  );
}

export interface FunFact {
  emoji: string;
  label: string;
  value: string;
  sub?: string;
}

export function useFunFacts(report: MonthReport): FunFact[] {
  const { category, personName } = useLookups();
  const stats: FunFact[] = [];

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
  return stats;
}

function FunFacts({ report }: { report: MonthReport }) {
  const stats = useFunFacts(report);
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
