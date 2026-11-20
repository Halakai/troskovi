import { useEffect, useMemo, useState } from 'react';
import { useData, useReportInput } from '../data/DataProvider';
import { monthReport, type CategoryStat, type MonthReport, type PersonStat, type UpcomingItem } from '../lib/stats';
import { addMonths, formatDay, formatMonth, formatMonthShort, WEEKDAYS, yearOf } from '../lib/dates';
import { formatMoney, percent } from '../lib/money';
import { navigate } from '../lib/router';
import type { Transaction } from '../types';
import { Avatar, CatIcon, Donut, Empty, MonthSwitcher, Progress, TopBar, useLookups } from '../components/ui';
import { TxRow } from '../components/TxRow';
import { IconClock, IconDown, IconRepeat } from '../components/Icons';

interface Props {
  month: string;
  setMonth: (m: string) => void;
  onOpen: (tx: Transaction) => void;
}

export function Overview({ month, setMonth, onOpen }: Props) {
  const data = useData();
  const { ensureYear } = data;
  const carryFrom = data.settings.carry_from;

  useEffect(() => {
    ensureYear(yearOf(month));
    ensureYear(yearOf(addMonths(month, -1)));
    // the leftover carried in depends on every month since carrying started
    if (carryFrom) for (let y = yearOf(carryFrom); y < yearOf(month); y++) ensureYear(y);
  }, [month, ensureYear, carryFrom]);

  const input = useReportInput();
  const report = useMemo(() => monthReport(input, month), [input, month]);

  const recent = [...report.transactions]
    .sort((a, b) => b.date.localeCompare(a.date) || b.created_at.localeCompare(a.created_at))
    .slice(0, 5);
  const loading = data.yearLoading(yearOf(month));

  return (
    <>
      <TopBar title={<MonthSwitcher month={month} onChange={setMonth} />} />

      <Hero report={report} />

      {report.transactions.length === 0 && report.upcoming.length === 0 && !report.carriedIn ? (
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
          <MoneyFlow report={report} onOpen={onOpen} />
          <People report={report} />
          <Categories report={report} />
          <Income report={report} />
          <Savings report={report} />
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

function MoneyFlow({ report, onOpen }: { report: MonthReport; onOpen: (tx: Transaction) => void }) {
  const carried = report.carriedIn ?? 0;
  if (!report.income && !report.expectedIncome && !report.upcoming.length && !carried) {
    return (
      <section className="card card-tip">
        💡 Add your salaries as <b>monthly income</b> (⚙️ → Monthly items) to see how much is left to spend each month –
        even before the second salary arrives.
      </section>
    );
  }
  const prevName = formatMonth(addMonths(report.month, -1)).split(' ')[0];
  const nextName = formatMonth(addMonths(report.month, 1)).split(' ')[0];
  // money still to come in is counted already; money still to go out waits for its day
  const incoming = report.upcoming.filter((u) => u.kind === 'income');
  const outgoing = report.upcoming.filter((u) => u.kind !== 'income');
  const past = !report.isCurrent && !report.isFuture;
  return (
    <section className="card">
      <h3>Money flow</h3>
      <div className="flow">
        {carried !== 0 && (
          <div className="flow-row">
            <span>{carried > 0 ? `Left over from ${prevName}` : `Overspent in ${prevName}`}</span>
            <span className={carried > 0 ? 'pos' : 'text-danger'}>{formatMoney(carried, { sign: true })}</span>
          </div>
        )}
        <div className="flow-row">
          <span>Income received</span>
          <span className="pos">{formatMoney(report.income)}</span>
        </div>
        {report.expectedIncome > 0 && (
          <>
            <div className="flow-row dim">
              <span>Still expected</span>
              <span className="pos">+{formatMoney(report.expectedIncome)}</span>
            </div>
            <div className="upcoming-in">
              {incoming.map((u) => (
                <UpcomingRow key={u.tx?.id ?? u.recurring!.id} item={u} onOpen={onOpen} />
              ))}
            </div>
          </>
        )}
        <div className="flow-row">
          <span>Spent</span>
          <span>−{formatMoney(report.spent)}</span>
        </div>
        {report.saved !== 0 && (
          <div className="flow-row">
            <span>{report.saved > 0 ? 'Put into savings' : 'Taken from savings'}</span>
            <span className="save">
              {report.saved > 0 ? '−' : '+'}
              {formatMoney(Math.abs(report.saved))}
            </span>
          </div>
        )}
        <div className="flow-row flow-total">
          <span>{past ? 'Balance' : 'Left to spend'}</span>
          <span className={report.leftToSpend < 0 ? 'text-danger' : 'pos'}>{formatMoney(report.leftToSpend, { sign: true })}</span>
        </div>
        {report.carriesOver && past && <div className="flow-note">carried into {nextName}</div>}
        {report.isFuture && report.expectedIncome === 0 && (
          <div className="flow-hint">
            💡 No income expected yet – salaries added as monthly items (⚙️ → Monthly items) would show up here
          </div>
        )}
      </div>
      {outgoing.length > 0 && (
        <div className="upcoming">
          {report.upcomingExpenses > 0 && (
            <div className="flow-row upcoming-head">
              <span>Still to pay</span>
              <span>−{formatMoney(report.upcomingExpenses)}</span>
            </div>
          )}
          {report.upcomingSavings !== 0 && (
            <div className="flow-row upcoming-head">
              <span>{report.upcomingSavings > 0 ? 'Still to put into savings' : 'Still to take from savings'}</span>
              <span className="save">
                {report.upcomingSavings > 0 ? '−' : '+'}
                {formatMoney(Math.abs(report.upcomingSavings))}
              </span>
            </div>
          )}
          {outgoing.map((u) => (
            <UpcomingRow key={u.tx?.id ?? u.recurring!.id} item={u} onOpen={onOpen} />
          ))}
          <div className="flow-hint">
            Not taken from Left to spend until its day
            {outgoing.some((u) => u.tx) && (
              <>
                {' '}– tap a <IconClock /> entry to mark it paid
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

/** A monthly item not posted yet, or an entry dated in the future (tap to open it). */
function UpcomingRow({ item: u, onOpen }: { item: UpcomingItem; onOpen: (tx: Transaction) => void }) {
  const { category, account, personName } = useLookups();
  const tone = u.kind === 'income' ? 'pos' : u.kind === 'saving' ? 'save' : '';
  const sign = u.kind === 'income' || u.amount_cents < 0 ? '+' : '−';
  const name = u.recurring
    ? u.recurring.name
    : u.tx!.note ||
      (u.kind === 'saving'
        ? account(u.tx!.savings_account_id)?.name
        : category(u.tx!.category_id, u.kind === 'income' ? 'income' : 'expense')?.name);
  const body = (
    <>
      {u.recurring ? <IconRepeat /> : <IconClock />}
      <span className="grow">
        {u.kind === 'saving' && '🐷 '}
        {name} <span className="dim">· {personName(u.person_id)}</span>
      </span>
      <span className="dim">{formatDay(u.date)}</span>
      <span className={tone}>
        {sign}
        {formatMoney(Math.abs(u.amount_cents), { whole: true })}
      </span>
    </>
  );
  return u.tx ? (
    <button className="upcoming-row" onClick={() => onOpen(u.tx!)}>
      {body}
    </button>
  ) : (
    <div className="upcoming-row">{body}</div>
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

export function CategoryList({
  stats,
  onPick,
  limitLabel = '',
}: {
  stats: CategoryStat[];
  onPick?: (id: string) => void;
  limitLabel?: string;
}) {
  return (
    <div className="cat-list">
      {stats.map((s) => (
        <CategoryItem key={s.category.id} stat={s} onPick={onPick} limitLabel={limitLabel} />
      ))}
    </div>
  );
}

function CategoryItem({ stat: s, onPick, limitLabel }: { stat: CategoryStat; onPick?: (id: string) => void; limitLabel: string }) {
  const [open, setOpen] = useState(false);
  const over = s.subs.filter((x) => x.limit !== null && x.spent > x.limit).length;
  return (
    <div className="cat-item">
      <CategoryRow stat={s} onPick={onPick} limitLabel={limitLabel} />
      {s.subs.length > 0 && (
        <>
          <button className={`cat-expand ${open ? 'cat-expand-open' : ''}`} onClick={() => setOpen(!open)} aria-expanded={open}>
            <IconDown width={16} height={16} />
            {s.subs.filter((x) => !x.general).length} subcategories
            {over > 0 && !open && <span className="text-danger"> · {over} over limit</span>}
          </button>
          {open && (
            <div className="cat-subs">
              {s.subs.map((sub) => (
                <CategoryRow key={sub.general ? 'general' : sub.category.id} stat={sub} onPick={onPick} limitLabel={limitLabel} sub />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function CategoryRow({
  stat: s,
  onPick,
  limitLabel,
  sub,
}: {
  stat: CategoryStat;
  onPick?: (id: string) => void;
  limitLabel: string;
  sub?: boolean;
}) {
  return (
    <button className={`cat-row ${sub ? 'cat-row-sub' : ''}`} onClick={() => onPick?.(s.category.id)}>
      <CatIcon category={s.category} size={sub ? 28 : 36} />
      <span className="grow">
        <span className="cat-row-top">
          <span className="cat-row-name">{s.general ? 'General' : s.category.name}</span>
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
            {s.count} ×{s.general ? ' · no subcategory picked' : s.category.kind === 'expense' && !sub && ' · no limit'}
          </span>
        )}
      </span>
    </button>
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
      <CategoryList stats={report.categories} onPick={(id) => navigate(`/category?id=${id}`)} />
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
      <CategoryList stats={report.incomeCategories} onPick={(id) => navigate(`/category?id=${id}`)} />
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
