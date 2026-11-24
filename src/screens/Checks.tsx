// Balance checks: the list with what's still to settle, the form, and one check with everything to explain it.
import { useEffect, useMemo, useState } from 'react';
import { useBalance, useData, useReportInput } from '../data/DataProvider';
import { errorMessage } from '../supabase';
import type { BalanceCheck, Transaction, TransactionInput, Wallet } from '../types';
import {
  cancelsWith,
  checksToJoin,
  effect,
  gapHints,
  openPeriods,
  periodLabel,
  periodOf,
  type BalancePeriod,
  type Hint,
} from '../lib/balance';
import { isUnaccounted, UNACCOUNTED } from '../lib/categories';
import { monthReport, upcomingRecurring } from '../lib/stats';
import { addDays, addMonths, formatDay, formatDayShort, formatDMY, formatTime, monthOf, todayISO, toISODate } from '../lib/dates';
import { centsToInput, formatMoney, parseAmount, parseBalance } from '../lib/money';
import { navigate } from '../lib/router';
import type { NewEntryDefaults } from '../components/TxSheet';
import { TxRow } from '../components/TxRow';
import { useToast } from '../components/Toast';
import { putOff, useCheckDue } from '../components/CheckPrompt';
import { CatIcon, DateInput, Empty, Field, Segmented, Sheet, TopBar, useLookups } from '../components/ui';
import { IconCheck, IconGear, IconRepeat, IconRight } from '../components/Icons';

const STATUS: Record<BalancePeriod['status'], { icon: string; label: string }> = {
  start: { icon: '🏁', label: 'Starting point' },
  matched: { icon: '✅', label: 'Matched' },
  settled: { icon: '✅', label: 'Settled' },
  'written-off': { icon: '❓', label: 'Written off' },
  open: { icon: '🔴', label: 'To settle' },
};

const tone = (cents: number) => (cents < 0 ? 'text-danger' : cents > 0 ? 'pos' : '');
const abs = (cents: number) => formatMoney(Math.abs(cents));

/** "€30.00 found · €13.20 written off" */
function explained(p: BalancePeriod): string[] {
  const parts: string[] = [];
  if (p.found + p.late !== 0) parts.push(`${abs(p.found + p.late)} found`);
  if (p.writtenOff !== 0) parts.push(`${abs(p.writtenOff)} written off`);
  return parts;
}

// ---------------------------------------------------------------- list

export function Checks() {
  const data = useData();
  const input = useReportInput();
  const { periods, loaded } = useBalance();
  const { personName } = useLookups();
  const onAccounts = useMemo(() => monthReport(input, monthOf(input.today)).onAccounts, [input]);

  const open = openPeriods(periods);
  const toSettle = open.reduce((s, p) => s + p.gap, 0);
  const last = periods[periods.length - 1];
  const newest = [...periods].reverse();

  const row = (p: BalancePeriod) => (
    <button key={p.check.id} className="cat-row" onClick={() => navigate(`/checks/week?id=${p.check.id}`)}>
      <span className="check-status">{STATUS[p.status].icon}</span>
      <span className="grow">
        <span className="cat-row-top">
          <span className="cat-row-name">{periodLabel(p)}</span>
          {p.status === 'open' ? (
            <b className={tone(p.gap)}>{formatMoney(p.gap, { sign: true })}</b>
          ) : (
            <span className="dim">{formatMoney(p.check.real_cents)}</span>
          )}
        </span>
        <span className="small dim block">
          {[
            p.status === 'open' ? (p.gap < 0 ? 'missing' : 'more than expected') : STATUS[p.status].label,
            ...explained(p),
            ...(p.joined.length ? [`${p.joined.length + 1} checks as one`] : []),
            personName(p.check.created_by),
          ].join(' · ')}
        </span>
      </span>
      <IconRight className="dim" />
    </button>
  );

  return (
    <>
      <TopBar
        title="Balance check"
        back="/"
        right={
          data.isAdmin && (
            <button className="icon-btn" onClick={() => navigate('/settings/check')} aria-label="Accounts, day and time">
              <IconGear width={22} height={22} />
            </button>
          )
        }
      />

      {!data.settings.carry_from ? (
        <div className="card">
          <Empty emoji="💶" title="Turn on leftover money first">
            The check compares the accounts with everything entered so far, so the months have to be connected: ⚙️ → Leftover
            money.
          </Empty>
        </div>
      ) : !loaded ? (
        <div className="card">
          <Empty emoji="⏳" title="Loading…" />
        </div>
      ) : !last ? (
        <div className="card">
          <Empty emoji="🧾" title="No checks yet">
            {data.isAdmin
              ? 'Once a week you type in what’s really on the accounts. The app compares that with what it expects, so you can see in which week something went missing.'
              : 'An admin does the first one.'}
          </Empty>
          {data.isAdmin && (
            <button className="btn btn-primary btn-block" onClick={() => navigate('/checks/new')}>
              Do the first check
            </button>
          )}
        </div>
      ) : (
        <>
          <section className="card hero">
            <div className="hero-label">{open.length ? 'To settle' : 'Everything matches'}</div>
            <div className={`hero-amount ${tone(toSettle)}`}>{open.length ? formatMoney(toSettle, { sign: true }) : '✅'}</div>
            <div className="hero-sub">
              {open.length ? (
                <>
                  All good until <b>{formatDayShort(open[0].prev!.date)}</b>
                </>
              ) : (
                <>
                  Last checked <b>{formatDay(last.check.date)}</b>
                </>
              )}
              {onAccounts !== null && (
                <>
                  {' · '}should be on accounts now: <b>{formatMoney(onAccounts)}</b>
                </>
              )}
            </div>
            {data.isAdmin && (
              <div className="hero-actions">
                <button className="btn btn-primary" onClick={() => navigate('/checks/new')}>
                  Check now
                </button>
                <button className="btn" onClick={() => navigate('/checks/new?past=1')}>
                  For a past day
                </button>
              </div>
            )}
          </section>

          {open.length > 0 && (
            <section className="card">
              <h3>Still to settle</h3>
              <div className="cat-list">{[...open].reverse().map(row)}</div>
            </section>
          )}

          <section className="card">
            <h3>All checks</h3>
            <div className="cat-list">{newest.map(row)}</div>
          </section>

          <p className="page-note">
            What’s to settle is already counted in Left to spend, but it isn’t spending or income until you know what it was.
          </p>
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------- form

const draftKey = (userId: string) => `troskovi.check.draft.${userId}`;

/** What was typed into an unfinished check – only for the rest of the day, balances get old quickly. */
function readDraft(userId: string): Record<string, string> {
  try {
    const d = JSON.parse(localStorage.getItem(draftKey(userId)) ?? 'null') as { day: string; values: Record<string, string> } | null;
    return d?.day === todayISO() ? d.values : {};
  } catch {
    return {};
  }
}

function writeDraft(userId: string, values: Record<string, string> | null) {
  try {
    if (values) localStorage.setItem(draftKey(userId), JSON.stringify({ day: todayISO(), values }));
    else localStorage.removeItem(draftKey(userId));
  } catch {
    /* ignore */
  }
}

/** ?past=1 starts with "End of a past day", ?id=… corrects the balances of a check. */
export function CheckForm({ params }: { params: URLSearchParams }) {
  const data = useData();
  const { periods, loaded } = useBalance();
  const id = params.get('id');
  const editing = data.checks.find((c) => c.id === id);

  let problem;
  if (!data.isAdmin) problem = <Empty emoji="🔒" title="Admins only" />;
  else if (!data.settings.carry_from) problem = <Empty emoji="💶" title="Turn on leftover money first" />;
  else if (!loaded || (id && !editing)) problem = <Empty emoji="⏳" title="Loading…" />;
  if (problem) {
    return (
      <>
        <TopBar title="Balance check" back="/checks" />
        <div className="card">{problem}</div>
      </>
    );
  }
  return <BalanceForm key={params.toString()} editing={editing} startPast={params.get('past') === '1'} latest={periods[periods.length - 1]?.check} />;
}

function BalanceForm({ editing, startPast, latest }: { editing?: BalanceCheck; startPast: boolean; latest?: BalanceCheck }) {
  const data = useData();
  const toast = useToast();
  const { personName, personColor } = useLookups();
  const due = useCheckDue();
  const carryFrom = data.settings.carry_from!;

  // the weekly check this form does (if it was waiting when the form was opened)
  const [dueAtOpen] = useState(due);
  const [past, setPast] = useState(startPast);
  const [day, setDay] = useState('');
  const [showErrors, setShowErrors] = useState(false);
  const [busy, setBusy] = useState(false);
  const [values, setValues] = useState<Record<string, string>>(() => {
    if (!editing) return past ? {} : readDraft(data.userId);
    const items = data.checkItems.filter((i) => i.check_id === editing.id);
    return Object.fromEntries(items.map((i) => [i.wallet_id, balanceToInput(i.amount_cents)]));
  });

  const activeIds = new Set(data.profiles.filter((p) => p.active).map((p) => p.id));
  const usable = (w: Wallet) => !w.archived && (w.owner_id === null || activeIds.has(w.owner_id));
  const wallets = data.wallets.filter((w) => usable(w) || (editing && values[w.id] !== undefined));
  // while correcting an old check, accounts that weren't part of it may stay empty
  const optional = (w: Wallet) => Boolean(editing) && !data.checkItems.some((i) => i.check_id === editing!.id && i.wallet_id === w.id);

  const lastBalance = (w: Wallet) => data.checkItems.find((i) => i.check_id === latest?.id && i.wallet_id === w.id)?.amount_cents;

  const cents = (w: Wallet) => parseBalance(values[w.id] ?? '');
  const isEmpty = (w: Wallet) => (values[w.id] ?? '').trim() === '';
  const invalid = (w: Wallet) => cents(w) === null && !(optional(w) && isEmpty(w));
  const total = wallets.reduce((s, w) => s + (cents(w) ?? 0), 0);
  const allFilled = wallets.every((w) => cents(w) !== null);
  const dayError = past && !editing && (!day || day >= todayISO() || day < carryFrom);

  const change = (w: Wallet, value: string) => {
    const next = { ...values, [w.id]: value };
    setValues(next);
    if (!editing && !past) writeDraft(data.userId, next);
  };
  const flipSign = (w: Wallet) => {
    const v = (values[w.id] ?? '').trim();
    change(w, v.startsWith('-') ? v.slice(1) : `-${v}`);
  };

  const doneBy =
    dueAtOpen && !due && !busy && !past && !editing
      ? data.checks.find((c) => !c.whole_day && Date.parse(c.checked_at) >= dueAtOpen.getTime())
      : undefined;

  async function save() {
    if (wallets.some(invalid) || dayError) {
      setShowErrors(true);
      return;
    }
    setBusy(true);
    try {
      // entries waiting on this phone belong to the comparison too
      if (data.pendingCount) await data.refresh();
      const id = await data.saveBalanceCheck({
        id: editing?.id,
        date: editing?.date ?? (past ? day : todayISO()),
        wholeDay: editing?.whole_day ?? past,
        items: wallets.filter((w) => !isEmpty(w)).map((w) => ({ wallet_id: w.id, amount_cents: cents(w)! })),
        due: !editing && !past ? dueAtOpen : null,
      });
      if (!editing && !past) writeDraft(data.userId, null);
      navigate(`/checks/week?id=${id}`);
    } catch (e) {
      toast(errorMessage(e), 'error');
      setBusy(false);
    }
  }

  if (doneBy) {
    return (
      <>
        <TopBar title="Balance check" back="/checks" />
        <div className="card">
          <Empty emoji="👍" title="Already done">
            {personName(doneBy.created_by)} has just filled it in – nothing left for you to do.
          </Empty>
          <button className="btn btn-primary btn-block" onClick={() => navigate(`/checks/week?id=${doneBy.id}`)}>
            See how it went
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      <TopBar title={editing ? 'Edit balances' : 'Balance check'} back={editing ? `/checks/week?id=${editing.id}` : '/checks'} />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        {editing ? (
          <p className="page-note">Balances {momentOf(editing)}.</p>
        ) : (
          <section className="card stack">
            <Segmented
              value={past ? 'past' : 'now'}
              onChange={(v) => {
                setPast(v === 'past');
                setValues(v === 'past' ? {} : readDraft(data.userId));
                setShowErrors(false);
              }}
              options={[
                { value: 'now', label: 'Right now' },
                { value: 'past', label: 'End of a past day' },
              ]}
            />
            {past && (
              <Field
                label="Balances at the end of"
                hint={
                  showErrors && dayError ? (
                    <span className="text-danger">
                      Pick a day between {formatDMY(carryFrom)} and {formatDMY(addDays(todayISO(), -1))}
                    </span>
                  ) : (
                    'From a bank statement – to see whether the app was still right back then'
                  )
                }
              >
                <DateInput value={day} onChange={setDay} />
              </Field>
            )}
          </section>
        )}

        <section className="card">
          <h3>What’s really there</h3>
          {wallets.length === 0 && (
            <Empty emoji="🏦" title="No accounts yet">
              <button type="button" className="link" onClick={() => navigate('/settings/check')}>
                Add the first one
              </button>
            </Empty>
          )}
          {wallets.map((w) => {
            const before = editing || past ? undefined : lastBalance(w);
            return (
              <div key={w.id} className="balance-row">
                <CatIcon category={{ emoji: w.emoji, color: personColor(w.owner_id) }} />
                <span className="balance-name">
                  <b>{w.owner_id ? personName(w.owner_id) : w.name}</b>
                  <span className="dim small block">
                    {w.owner_id ? w.name : 'Shared'}
                    {before !== undefined && ` · last ${formatMoney(before)}`}
                  </span>
                </span>
                <span className={`balance-input ${showErrors && invalid(w) ? 'balance-invalid' : ''}`}>
                  <button
                    type="button"
                    className="balance-sign"
                    onClick={() => flipSign(w)}
                    aria-label={`${w.name}: below zero`}
                    aria-pressed={(values[w.id] ?? '').trim().startsWith('-')}
                  >
                    ±
                  </button>
                  <input
                    className="input"
                    inputMode="decimal"
                    enterKeyHint="next"
                    autoComplete="off"
                    placeholder="0.00"
                    value={values[w.id] ?? ''}
                    onChange={(e) => change(w, e.target.value)}
                    aria-label={`${w.owner_id ? `${personName(w.owner_id)} – ` : ''}${w.name}`}
                  />
                </span>
              </div>
            );
          })}
          {wallets.length > 0 && (
            <div className="flow-row flow-total">
              <span>Together</span>
              <span>{allFilled || editing ? formatMoney(total) : '…'}</span>
            </div>
          )}
          {showErrors && wallets.some(invalid) && <p className="form-error">Fill in every account – 0 if there’s nothing on it.</p>}
          <p className="flow-hint">
            The balance without the allowed overdraft (some banks add it to “available”). Tap ± if it’s below zero. Savings
            accounts aren’t part of this.
          </p>
        </section>

        <button className="btn btn-primary btn-block" disabled={busy || wallets.length === 0}>
          {busy ? 'Comparing…' : editing ? 'Save' : 'Compare with the app'}
        </button>
        {!editing && (
          <button
            type="button"
            className="btn btn-ghost btn-block"
            disabled={busy}
            onClick={() => {
              if (dueAtOpen) putOff(data.userId);
              navigate('/');
            }}
          >
            Later
          </button>
        )}
      </form>
    </>
  );
}

const balanceToInput = (cents: number) => (cents < 0 ? `-${centsToInput(-cents)}` : centsToInput(cents));

/** "from Sun, 22 Nov at 14:32" / "from the end of Sat, 31 Oct" */
function momentOf(c: BalanceCheck): string {
  return c.whole_day ? `from the end of ${formatDay(c.date)}` : `from ${formatDay(c.date)} at ${formatTime(c.checked_at)}`;
}

// ---------------------------------------------------------------- one check

interface WeekProps {
  params: URLSearchParams;
  onAdd: (defaults: NewEntryDefaults) => void;
  onOpen: (tx: Transaction) => void;
}

export function CheckWeek({ params, onAdd, onOpen }: WeekProps) {
  const data = useData();
  const toast = useToast();
  const { periods, loaded } = useBalance();
  const { personName } = useLookups();
  const [writingOff, setWritingOff] = useState(false);
  const [busy, setBusy] = useState(false);
  const p = periodOf(periods, params.get('id'));

  if (!p || !loaded) {
    return (
      <>
        <TopBar title="Balance check" back="/checks" />
        <div className="card">
          {loaded && data.syncedAt !== null ? <Empty emoji="🧾" title="This check no longer exists" /> : <Empty emoji="⏳" title="Loading…" />}
        </div>
      </>
    );
  }

  const { check, gap } = p;
  const isOpen = p.status === 'open';
  const writeOffs = p.entries.filter((t) => t.write_off && t.balance_check_id);
  const cameLater = p.entries.filter(
    (t) => !t.write_off && (t.balance_check_id || Date.parse(t.created_at) > Date.parse(check.checked_at)),
  );
  const partner = cancelsWith(periods, p);
  // written off, but an entry that explains (part of) it came in later: the write-off is now too big
  const tooMuch = isOpen && gap * p.writtenOff < 0 ? Math.min(Math.abs(gap), Math.abs(p.writtenOff)) : 0;

  const run = async (job: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    try {
      await job();
      if (done) toast(done);
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  /** Takes `cents` off the write-offs of this check (they go away when nothing is left). */
  const reduceWriteOffs = async (cents: number, list = writeOffs) => {
    let left = cents;
    for (const t of list) {
      const part = Math.min(left, t.amount_cents);
      if (part <= 0) break;
      if (part === t.amount_cents) await data.deleteTransaction(t.id);
      else await data.updateTransaction(t.id, { amount_cents: t.amount_cents - part });
      left -= part;
    }
  };

  const foundIt = () =>
    onAdd({ kind: gap < 0 ? 'expense' : 'income', amountCents: Math.abs(gap), date: check.date, checkId: check.id });

  const foundWrittenOff = (t: Transaction) =>
    onAdd({
      kind: t.kind,
      amountCents: t.amount_cents,
      date: check.date,
      checkId: check.id,
      onAdded: async (input: TransactionInput) => {
        // only an entry that goes the same way explains the write-off
        if (Math.sign(effect(input)) === Math.sign(effect(t))) await reduceWriteOffs(Math.min(input.amount_cents, t.amount_cents), [t]);
      },
    });

  const remove = () => {
    if (!confirm(`Delete the check of ${formatDayShort(check.date)}? Its write-offs are removed too; entries stay.`)) return;
    run(async () => {
      await data.deleteBalanceCheck(check.id);
      navigate('/checks');
    }, 'Deleted');
  };

  return (
    <>
      <TopBar title={periodLabel(p)} back="/checks" />

      <section className="card hero">
        {isOpen ? (
          <>
            <div className="hero-label">
              {STATUS.open.icon} {gap < 0 ? 'Missing' : 'More than expected'}
            </div>
            <div className={`hero-amount ${tone(gap)}`}>{formatMoney(gap, { sign: true })}</div>
          </>
        ) : (
          <div className="hero-label check-result">
            {STATUS[p.status].icon} {STATUS[p.status].label}
          </div>
        )}
        <div className="flow">
          <div className="flow-row">
            <span>Really on the accounts</span>
            <span>{formatMoney(check.real_cents)}</span>
          </div>
          <div className="flow-row">
            <span>{p.prev ? 'App expected' : 'App knew about'}</span>
            <span>{formatMoney(p.expected)}</span>
          </div>
          <div className="flow-row flow-total">
            <span>{p.prev ? 'Difference' : 'Starting balance'}</span>
            <span className={tone(p.prev ? gap : p.start)}>{formatMoney(p.prev ? gap : p.start, { sign: true })}</span>
          </div>
        </div>
        {explained(p).length > 0 && <p className="flow-hint">Already explained: {explained(p).join(', ')}</p>}
        {!p.prev && (
          <p className="flow-hint">
            This is where checking starts. The starting balance is money that was there before the app knew about it – it’s in
            Left to spend, but it isn’t income.
          </p>
        )}
        {isOpen && tooMuch === 0 && (
          <div className="hero-actions">
            <button className="btn btn-primary" onClick={foundIt} disabled={busy}>
              Found it
            </button>
            {data.isAdmin && (
              <button className="btn" onClick={() => setWritingOff(true)} disabled={busy}>
                Write off
              </button>
            )}
          </div>
        )}
      </section>

      {tooMuch > 0 && (
        <section className="card card-tip">
          <p>
            {formatMoney(Math.abs(p.writtenOff))} was written off here, but {formatMoney(tooMuch)} of it has turned up since – so
            it’s counted twice now.
          </p>
          {data.isAdmin ? (
            <button className="btn btn-primary btn-block" disabled={busy} onClick={() => run(() => reduceWriteOffs(tooMuch), 'Write-off reduced')}>
              Reduce the write-off by {formatMoney(tooMuch)}
            </button>
          ) : (
            <p className="small dim">An admin can reduce the write-off.</p>
          )}
        </section>
      )}

      {partner && tooMuch === 0 && (
        <section className="card card-tip">
          <p>
            <b>{formatMoney(gap, { sign: true })}</b> here and <b>{formatMoney(partner.gap, { sign: true })}</b> in {periodLabel(partner)}{' '}
            cancel each other out. Usually the bank just booked something a bit later or earlier than the app.
          </p>
          {data.isAdmin && (
            <button
              className="btn btn-primary btn-block"
              disabled={busy}
              onClick={() => run(() => data.joinBalanceChecks(checksToJoin(periods, p, partner), true), 'Both settled')}
            >
              Settle both
            </button>
          )}
        </section>
      )}

      {isOpen && tooMuch === 0 && <Hints period={p} onOpen={onOpen} run={run} busy={busy} />}

      {(writeOffs.length > 0 || cameLater.length > 0) && (
        <section className="card">
          <h3>Explained since</h3>
          {cameLater.map((t) => (
            <TxRow key={t.id} tx={t} onClick={() => onOpen(t)} showDate />
          ))}
          {writeOffs.map((t) => (
            <div key={t.id}>
              <TxRow tx={t} onClick={() => onOpen(t)} />
              {data.isAdmin && (
                <div className="row-actions">
                  <button className="chip" disabled={busy} onClick={() => foundWrittenOff(t)}>
                    Found it after all
                  </button>
                  <button className="chip" disabled={busy} onClick={() => run(() => data.deleteTransaction(t.id), 'Write-off undone')}>
                    Undo write-off
                  </button>
                </div>
              )}
            </div>
          ))}
        </section>
      )}

      {p.prev && <Entries period={p} onOpen={onOpen} />}

      <section className="card">
        <div className="card-head">
          <h3>About this check</h3>
          {data.isAdmin && (
            <button className="link" onClick={() => navigate(`/checks/edit?id=${check.id}`)}>
              Edit balances
            </button>
          )}
        </div>
        {data.isAdmin &&
          data.wallets
            .map((w) => ({ w, item: data.checkItems.find((i) => i.check_id === check.id && i.wallet_id === w.id) }))
            .filter((x) => x.item)
            .map(({ w, item }) => (
              <div key={w.id} className="flow-row">
                <span>
                  {w.emoji} {w.owner_id ? `${personName(w.owner_id)} – ${w.name}` : w.name}
                </span>
                <span>{formatMoney(item!.amount_cents)}</span>
              </div>
            ))}
        {p.prev && check.adjust_cents !== 0 && (
          <div className="flow-row dim">
            <span>{check.adjust_cents > 0 ? 'Accounts added' : 'Accounts removed'}</span>
            <span>{formatMoney(check.adjust_cents, { sign: true })}</span>
          </div>
        )}
        <p className="flow-hint">
          Balances {momentOf(check)}, filled in by {personName(check.created_by)}.
        </p>
        {p.joined.length > 0 && (
          <p className="flow-hint">
            Counted as one with {p.joined.map((c) => formatDayShort(c.date)).join(', ')}, because the differences cancelled out.{' '}
            {data.isAdmin && (
              <button
                className="link"
                disabled={busy}
                onClick={() => run(() => data.joinBalanceChecks(p.joined.map((c) => c.id), false), 'Separated')}
              >
                Separate
              </button>
            )}
          </p>
        )}
        {data.isAdmin && (
          <button className="link text-danger" disabled={busy} onClick={remove}>
            Delete this check
          </button>
        )}
      </section>

      {writingOff && <WriteOffSheet period={p} onClose={() => setWritingOff(false)} />}
    </>
  );
}

/** Single entries that would explain the whole difference. */
function Hints({
  period: p,
  onOpen,
  run,
  busy,
}: {
  period: BalancePeriod;
  onOpen: (tx: Transaction) => void;
  run: (job: () => Promise<unknown>, done?: string) => Promise<void>;
  busy: boolean;
}) {
  const data = useData();
  const { personName } = useLookups();
  const today = todayISO();
  const upcoming = [0, 1].flatMap((n) => upcomingRecurring(data.recurring, addMonths(monthOf(today), n), today));
  const hints = gapHints(p, data.allTransactions, upcoming, today);
  const automatic = p.entries.filter((t) => t.recurring_id).slice(0, 6);

  const people = data.profiles.filter((x) => x.active).sort((a, b) => a.created_at.localeCompare(b.created_at));
  const lastEntry = (id: string) =>
    data.allTransactions.reduce<string>((m, t) => (t.created_by === id && !t.recurring_id && t.created_at > m ? t.created_at : m), '');

  const canEdit = (t: Transaction) => data.isAdmin || t.created_by === data.userId;
  const countHere = (t: Transaction) =>
    run(
      () => data.updateTransaction(t.id, { balance_check_id: p.check.id, ...(t.date > p.check.date ? { date: p.check.date } : {}) }),
      'Settled',
    );
  const past = p.gap < 0 ? 'been paid' : 'arrived';
  const text = (h: Hint): string => {
    switch (h.why) {
      case 'after':
        return 'Entered after this check, with exactly this amount. Did it happen before?';
      case 'planned':
        return `Planned for ${formatDayShort(h.tx.date)}. Has it already ${past}?`;
      case 'duplicate':
        return 'There are two of these. Was it entered twice?';
      case 'unpaid':
        return h.tx.kind === 'income'
          ? 'Exactly this amount. Has it really arrived?'
          : 'Exactly this amount. Has it really left the account? If the bank is just late, next week will cancel it out.';
      case 'wrong-side':
        return h.tx.kind === 'income' ? 'Should this be an expense?' : 'Should this be an income?';
      case 'typo':
        return `Maybe ${formatMoney(h.amount)} instead of ${formatMoney(h.tx.amount_cents)}?`;
      case 'monthly':
        return `${h.item.name} is expected on ${formatDayShort(h.date)}. If it has already ${past}, next week will cancel this out.`;
    }
  };

  return (
    <section className="card">
      <h3>Could it be this?</h3>
      {hints.map((h) =>
        h.why === 'monthly' ? (
          <p key={h.item.id} className="hint-text">
            <IconRepeat /> {text(h)}
          </p>
        ) : (
          <div key={`${h.why}${h.tx.id}`} className="hint">
            <TxRow tx={h.tx} onClick={() => onOpen(h.tx)} showDate />
            <p className="hint-text">{text(h)}</p>
            {(h.why === 'after' || h.why === 'planned') && canEdit(h.tx) && (
              <div className="row-actions">
                <button className="chip chip-on" disabled={busy} onClick={() => countHere(h.tx)}>
                  Yes, that’s it
                </button>
              </div>
            )}
          </div>
        ),
      )}
      {automatic.length > 0 && (
        <>
          <p className="hint-text">Added automatically in this time – are the amounts right?</p>
          {automatic.map((t) => (
            <TxRow key={t.id} tx={t} onClick={() => onOpen(t)} showDate />
          ))}
        </>
      )}
      <p className="hint-text">
        {hints.length === 0 && 'No single entry explains the whole amount. '}
        Last thing entered by{' '}
        {people.map((x, i) => {
          const at = lastEntry(x.id);
          return `${i ? ', ' : ''}${personName(x.id)}: ${at ? formatDay(toISODate(new Date(at))) : 'nothing yet'}`;
        })}
        .
      </p>
    </section>
  );
}

const ticksKey = (checkId: string) => `troskovi.check.ticks.${checkId}`;

/** Everything in this time, to tick off against the bank's list. */
function Entries({ period: p, onOpen }: { period: BalancePeriod; onOpen: (tx: Transaction) => void }) {
  const [ticked, setTicked] = useState<Set<string>>(() => new Set());
  const id = p.check.id;

  useEffect(() => {
    try {
      setTicked(new Set(JSON.parse(localStorage.getItem(ticksKey(id)) ?? '[]') as string[]));
    } catch {
      setTicked(new Set());
    }
  }, [id]);

  const toggle = (t: Transaction) => {
    const next = new Set(ticked);
    if (!next.delete(t.id)) next.add(t.id);
    setTicked(next);
    try {
      localStorage.setItem(ticksKey(id), JSON.stringify([...next]));
    } catch {
      /* ignore */
    }
  };

  const list = p.entries.filter((t) => !t.write_off);
  const done = list.filter((t) => ticked.has(t.id)).length;
  if (!list.length) return null;
  return (
    <details className="card check-entries" open={p.status === 'open'}>
      <summary>
        <b>Entries in this time</b>
        <span className="dim small">{done ? `${done} of ${list.length} ticked` : list.length}</span>
      </summary>
      <p className="flow-hint">Go through your bank’s list and tick off what’s here. What’s left over on either side is the difference.</p>
      {list.map((t) => (
        <div key={t.id} className="tick-row">
          <button
            className={`tx-check ${ticked.has(t.id) ? 'tx-check-on' : ''}`}
            role="checkbox"
            aria-checked={ticked.has(t.id)}
            aria-label="Seen at the bank"
            onClick={() => toggle(t)}
          >
            {ticked.has(t.id) && <IconCheck />}
          </button>
          <TxRow tx={t} onClick={() => onOpen(t)} showDate />
        </div>
      ))}
    </details>
  );
}

function WriteOffSheet({ period: p, onClose }: { period: BalancePeriod; onClose: () => void }) {
  const data = useData();
  const toast = useToast();
  const max = Math.abs(p.gap);
  const kind = p.gap < 0 ? 'expense' : 'income';
  const [amount, setAmount] = useState(centsToInput(max));
  const [busy, setBusy] = useState(false);
  const cents = parseAmount(amount);
  const ok = cents !== null && cents <= max;

  /** The category write-offs go to: the one used before, or a new one. */
  const category = async () => {
    const list = data.categories.filter((c) => c.kind === kind);
    const used = data.allTransactions.find((t) => t.write_off && t.kind === kind && list.some((c) => c.id === t.category_id));
    const known = list.find((c) => c.id === used?.category_id) ?? list.find(isUnaccounted);
    return (
      known ??
      (await data.saveCategory({ name: UNACCOUNTED, emoji: '❓', color: '#64748b', owner_id: null, kind, parent_id: null, default_shared: true }))
    );
  };

  async function save() {
    if (!ok) return;
    setBusy(true);
    try {
      const cat = await category();
      await data.addTransaction({
        kind,
        amount_cents: cents,
        category_id: cat.id,
        savings_account_id: null,
        person_id: null,
        date: p.check.date,
        note: `Balance check ${periodLabel(p)}`,
        balance_check_id: p.check.id,
        write_off: true,
      });
      toast(`${formatMoney(cents)} written off`);
      onClose();
    } catch (e) {
      toast(errorMessage(e), 'error');
      setBusy(false);
    }
  }

  return (
    <Sheet title="Write off" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <div className={`amount ${ok ? '' : 'invalid'}`}>
          <span className="amount-currency">€</span>
          <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" enterKeyHint="done" autoComplete="off" aria-label="Amount" />
        </div>
        <p className="small dim">
          {ok ? (
            <>
              Becomes a shared {kind} in ❓ {UNACCOUNTED} on {formatDMY(p.check.date)}
              {cents < max ? ` – ${formatMoney(max - cents)} stays to settle` : ''}. Left to spend stays the same. You can undo
              it any time.
            </>
          ) : (
            <span className="text-danger">At most {formatMoney(max)}</span>
          )}
        </p>
        <div className="sheet-actions">
          <button className="btn btn-primary btn-grow" disabled={!ok || busy}>
            {busy ? 'Saving…' : 'Write off'}
          </button>
        </div>
      </form>
    </Sheet>
  );
}
