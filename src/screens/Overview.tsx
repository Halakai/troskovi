// Home: what's left, where the money went, and a way into everything else about the month.
import { useState } from 'react';
import { useBalance } from '../data/DataProvider';
import { useMonthReport } from '../data/useMonthReport';
import { moneySummary, topCategories, topSpender, type MonthReport, type UpcomingItem } from '../lib/stats';
import { correctionTotal, openPeriods } from '../lib/balance';
import { addMonths, formatDay, formatDayShort, formatMonth, formatMonthShort } from '../lib/dates';
import { formatMoney } from '../lib/money';
import { navigate } from '../lib/router';
import type { Transaction } from '../types';
import { Donut, Empty, MonthSwitcher, TopBar, useLookups } from '../components/ui';
import { CheckDueCard } from '../components/CheckPrompt';
import { IconClock, IconDown, IconRepeat, IconRight } from '../components/Icons';
import { useFunFacts, type MonthTab } from './MonthDetail';

interface Props {
  month: string;
  setMonth: (m: string) => void;
  onOpen: (tx: Transaction) => void;
}

export function Overview({ month, setMonth, onOpen }: Props) {
  const { report, loading } = useMonthReport(month);
  const empty =
    report.transactions.length === 0 && report.upcoming.length === 0 && !report.carriedIn && !correctionTotal(report.corrections);

  return (
    <>
      <TopBar title={<MonthSwitcher month={month} onChange={setMonth} />} />

      <CheckDueCard />
      {empty ? (
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
          <Spending report={report} />
          <More report={report} />
        </>
      )}
    </>
  );
}

const openTab = (tab: MonthTab) => navigate(`/month?tab=${tab}`);

/** The biggest categories; all of them are one tap away. */
function Spending({ report }: { report: MonthReport }) {
  const { top, rest } = topCategories(report.categories, 5);
  if (!top.length) return null;
  const diff = report.previousSpent ? Math.round(((report.spent - report.previousSpent) / report.previousSpent) * 100) : null;
  const overLimit = report.categories
    .flatMap((c) => [c, ...c.subs])
    .filter((c) => c.limit !== null && c.spent > c.limit)
    .map((c) => ({ ...c, over: c.spent - c.limit! }));

  return (
    <section className="card">
      <div className="card-head">
        <h3>Spending</h3>
        <button className="link" onClick={() => openTab('spending')}>
          See all
        </button>
      </div>
      <div className="donut-wrap">
        <Donut
          segments={[
            ...top.map((c) => ({ value: c.spent, color: c.category.color })),
            { value: rest.spent, color: 'color-mix(in srgb, var(--dim) 25%, transparent)' },
          ]}
        >
          <b className="donut-total">{formatMoney(report.spent, { whole: true })}</b>
          {diff !== null && !report.isFuture && (
            <span className={`donut-diff ${diff > 0 ? 'text-danger' : 'pos'}`}>
              {diff > 0 ? '▲' : '▼'} {Math.abs(diff)}% vs {formatMonthShort(addMonths(report.month, -1))}
            </span>
          )}
        </Donut>
        <div className="legend">
          {top.map((c) => (
            <button key={c.category.id} className="legend-row" onClick={() => navigate(`/category?id=${c.category.id}`)}>
              <span className="dot" style={{ background: c.category.color }} />
              <span className="grow">{c.category.name}</span>
              <b>{formatMoney(c.spent, { whole: true })}</b>
            </button>
          ))}
          {rest.count > 0 && (
            <button className="legend-row dim" onClick={() => openTab('spending')}>
              <span className="dot legend-rest" />
              <span className="grow">{rest.count} more</span>
              <span>{formatMoney(rest.spent, { whole: true })}</span>
            </button>
          )}
        </div>
      </div>
      {overLimit.slice(0, 3).map((c) => (
        <button key={c.category.id} className="over-limit" onClick={() => navigate(`/category?id=${c.category.id}`)}>
          <span className="grow">
            {c.category.emoji} {c.category.name}
          </span>
          <span className="text-danger">{formatMoney(c.over, { whole: true })} over limit</span>
        </button>
      ))}
      {overLimit.length > 3 && (
        <button className="over-limit dim" onClick={() => openTab('spending')}>
          {overLimit.length - 3} more over their limit
        </button>
      )}
    </section>
  );
}

/** One line each about the rest of the month; a tap shows all of it. */
function More({ report }: { report: MonthReport }) {
  const { category, account, personName } = useLookups();
  const facts = useFunFacts(report);
  const rows: { emoji: string; title: string; text: string; open: () => void }[] = [];

  if (report.spent > 0) {
    const spender = topSpender(report.people, report.spent);
    const text = !spender
      ? report.people.filter((p) => p.spent > 0).map((p) => `${p.name} ${formatMoney(p.spent, { whole: true })}`).join(' · ')
      : spender.even
        ? 'Neck and neck'
        : `${spender.name} spent ${formatMoney(spender.gap, { whole: true })} more`;
    rows.push({ emoji: '👥', title: 'Who spent what', text, open: () => openTab('people') });
  }
  if (report.income > 0) {
    rows.push({ emoji: '💼', title: 'Income', text: `${formatMoney(report.income, { whole: true })} came in`, open: () => openTab('income') });
  }
  if (report.saved !== 0 || report.upcomingSavings > 0) {
    const text =
      report.saved === 0
        ? `${formatMoney(report.upcomingSavings, { whole: true })} planned`
        : `${formatMoney(Math.abs(report.saved), { whole: true })} ${report.saved > 0 ? 'put aside' : 'taken out'}`;
    rows.push({ emoji: '🐷', title: 'Savings', text, open: () => openTab('savings') });
  }
  if (report.spent > 0 && facts.length > 0) {
    // a different one every day
    const fact = facts[new Date().getDate() % facts.length];
    rows.push({ emoji: '🎲', title: 'Fun facts', text: `${fact.label}: ${fact.value}`, open: () => openTab('facts') });
  }
  const latest = report.transactions.reduce<Transaction | null>(
    (m, t) => (!m || t.date > m.date || (t.date === m.date && t.created_at > m.created_at) ? t : m),
    null,
  );
  if (latest) {
    const what =
      latest.note ||
      (latest.kind === 'saving' ? account(latest.savings_account_id)?.name : category(latest.category_id, latest.kind)?.name);
    const sign = latest.kind === 'income' || latest.amount_cents < 0 ? '+' : '−';
    rows.push({
      emoji: '🕘',
      title: 'Latest entry',
      text: `${what} ${sign}${formatMoney(Math.abs(latest.amount_cents))} · ${personName(latest.person_id)}`,
      open: () => navigate('/history'),
    });
  }
  if (!rows.length) return null;

  return (
    <section className="card">
      <h3>More about {formatMonth(report.month).split(' ')[0]}</h3>
      <div className="menu">
        {rows.map((r) => (
          <button key={r.title} className="menu-item more-row" onClick={r.open}>
            <span className="more-emoji">{r.emoji}</span>
            <span className="grow">
              {r.title}
              <span className="dim small block">{r.text}</span>
            </span>
            <IconRight />
          </button>
        ))}
      </div>
    </section>
  );
}

function MoneyFlow({ report, onOpen }: { report: MonthReport; onOpen: (tx: Transaction) => void }) {
  const [details, setDetails] = useState(false);
  if (!report.income && !report.expectedIncome && !report.upcoming.length && !report.carriedIn && !correctionTotal(report.corrections)) {
    return (
      <section className="card card-tip">
        💡 Add your salaries as <b>monthly income</b> (⚙️ → Monthly items) to see how much is left to spend each month –
        even before the second salary arrives.
      </section>
    );
  }
  const monthName = (m: string) => formatMonth(m).split(' ')[0];
  const past = !report.isCurrent && !report.isFuture;
  const { start, cameIn, wentOut } = moneySummary(report);
  return (
    <section className="card">
      <div className="left-head">
        <span className="hero-label">{past ? `Left at the end of ${monthName(report.month)}` : 'Left to spend'}</span>
        {report.isCurrent && <CheckChip />}
      </div>
      <div className={`left-amount ${report.leftToSpend < 0 ? 'text-danger' : 'pos'}`}>{formatMoney(report.leftToSpend)}</div>
      {report.onAccounts !== null && report.expectedIncome > 0 && (
        <div className="left-sub on-accounts">
          <b>{formatMoney(report.onAccounts)}</b> should be on accounts now
        </div>
      )}
      {report.carriesOver && past && <div className="left-sub">Carried into {monthName(addMonths(report.month, 1))}</div>}
      {report.isFuture && report.expectedIncome === 0 && (
        <div className="left-sub">
          💡 No income expected yet – salaries added as monthly items (⚙️ → Monthly items) would show up here
        </div>
      )}

      <div className="sum-tiles">
        {start !== 0 && (
          <div className="sum-tile">
            <span>Started with</span>
            <b className={start < 0 ? 'text-danger' : ''}>{formatMoney(start, { whole: true })}</b>
          </div>
        )}
        <div className="sum-tile">
          <span>{report.expectedIncome > 0 ? 'Comes in' : 'Came in'}</span>
          <b className={cameIn > 0 ? 'pos' : ''}>{formatMoney(cameIn, { whole: true, sign: true })}</b>
        </div>
        <div className="sum-tile">
          <span>Went out</span>
          <b>{formatMoney(-wentOut, { whole: true })}</b>
        </div>
      </div>
      <button className={`cat-expand flow-expand ${details ? 'cat-expand-open' : ''}`} onClick={() => setDetails(!details)} aria-expanded={details}>
        <IconDown width={16} height={16} />
        {details ? 'Hide details' : 'Details'}
      </button>
      {details && <FlowDetails report={report} />}

      <Upcoming report={report} onOpen={onOpen} />
    </section>
  );
}

/** Every line that makes up what's left. */
function FlowDetails({ report }: { report: MonthReport }) {
  const prevName = formatMonth(addMonths(report.month, -1)).split(' ')[0];
  const fix = report.corrections;
  const carried = report.carriedIn ?? 0;
  const rows: { label: string; cents: number; tone?: string }[] = [
    { label: carried > 0 ? `Left over from ${prevName}` : `Overspent in ${prevName}`, cents: carried },
    { label: 'Starting balance', cents: fix.start },
    { label: fix.accounts > 0 ? 'Accounts added' : 'Accounts removed', cents: fix.accounts },
    { label: 'Income received', cents: report.income },
    { label: 'Income still expected', cents: report.expectedIncome },
    { label: 'Spent', cents: -report.spent, tone: '' },
    { label: report.saved > 0 ? 'Put into savings' : 'Taken from savings', cents: -report.saved, tone: 'save' },
    { label: 'To settle', cents: fix.toSettle },
    { label: 'Small differences', cents: fix.small, tone: 'dim' },
  ];
  return (
    <div className="flow flow-details">
      {rows
        .filter((r) => r.cents !== 0)
        .map((r) => (
          <div key={r.label} className="flow-row">
            <span>{r.label}</span>
            <span className={r.tone ?? (r.cents < 0 ? 'text-danger' : 'pos')}>{formatMoney(r.cents, { sign: true })}</span>
          </div>
        ))}
    </div>
  );
}

/** How the last balance check went. */
function CheckChip() {
  const { periods } = useBalance();
  const last = periods[periods.length - 1];
  if (!last) return null;
  const open = openPeriods(periods);
  const toSettle = open.reduce((s, p) => s + p.gap, 0);
  return (
    <button className={`chip check-chip ${open.length ? (toSettle < 0 ? 'chip-bad' : 'chip-good') : ''}`} onClick={() => navigate('/checks')}>
      {open.length ? `🧾 ${formatMoney(toSettle, { sign: true })} to settle` : `✅ checked ${formatDayShort(last.check.date)}`}
    </button>
  );
}

/** What's still coming this month, in groups. */
function Upcoming({ report, onOpen }: { report: MonthReport; onOpen: (tx: Transaction) => void }) {
  const of = (kind: UpcomingItem['kind']) => report.upcoming.filter((u) => u.kind === kind);
  const groups = [
    { title: 'Still to come in', note: 'already counted', items: of('income'), cents: report.expectedIncome, tone: 'pos' },
    { title: 'Still to pay', note: 'not counted yet', items: of('expense'), cents: -report.upcomingExpenses, tone: '' },
    {
      title: report.upcomingSavings < 0 ? 'Still to take from savings' : 'Still to put into savings',
      note: 'not counted yet',
      items: of('saving'),
      cents: -report.upcomingSavings,
      tone: 'save',
    },
  ].filter((g) => g.items.length > 0);
  return (
    <>
      {groups.map((g) => (
        <div key={g.title} className="upcoming">
          <div className="flow-row upcoming-head">
            <span>
              {g.title} <span className="upcoming-note">{g.note}</span>
            </span>
            {/* with a single item the amount is right below */}
            {g.items.length > 1 && <span className={g.tone}>{formatMoney(g.cents, { sign: true })}</span>}
          </div>
          {g.items.map((u) => (
            <UpcomingRow key={u.tx?.id ?? u.recurring!.id} item={u} onOpen={onOpen} />
          ))}
        </div>
      ))}
    </>
  );
}

/** A monthly item not posted yet, or an entry dated in the future (tap to open it and mark it paid). */
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
        {name}
        <span className="dim small block">
          {formatDay(u.date)} · {personName(u.person_id)}
        </span>
      </span>
      <span className={tone}>
        {sign}
        {formatMoney(Math.abs(u.amount_cents))}
      </span>
      {u.tx && <IconRight width={16} height={16} />}
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
