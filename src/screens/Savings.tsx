import { useEffect, useMemo, useState } from 'react';
import { useData, useReportInput } from '../data/DataProvider';
import { errorMessage } from '../supabase';
import type { SavingsAccount, Transaction } from '../types';
import { savingsReport, type AccountStat } from '../lib/stats';
import { formatMonth, formatMonthShort } from '../lib/dates';
import { centsToInput, formatMoney, parseAmount, percent } from '../lib/money';
import { navigate } from '../lib/router';
import type { NewEntryDefaults } from '../components/TxSheet';
import { TxRow } from '../components/TxRow';
import { useToast } from '../components/Toast';
import { Avatar, CatIcon, ColorPicker, Empty, Field, Progress, Segmented, Sheet, Toggle, TopBar, useLookups } from '../components/ui';
import { IconLock, IconPlus } from '../components/Icons';

const EMOJIS = ['🐷', '💶', '🏦', '🆘', '🏖️', '✈️', '🚗', '🏠', '💍', '👶', '🎓', '🎁', '💻', '📈', '🛋️', '🎄'];
const signed = (cents: number, whole = false) => `${cents < 0 ? '−' : '+'}${formatMoney(Math.abs(cents), { whole })}`;

interface Props {
  params: URLSearchParams;
  onAdd: (defaults: NewEntryDefaults) => void;
  onOpen: (tx: Transaction) => void;
}

export function Savings({ params, onAdd, onOpen }: Props) {
  const data = useData();
  const input = useReportInput();
  const report = useMemo(() => savingsReport(input), [input]);
  const { personName, personColor } = useLookups();
  const [editing, setEditing] = useState<SavingsAccount | 'new' | null>(null);

  // "Create one" in the add sheet links here with ?new=1
  useEffect(() => {
    if (params.get('new')) {
      setEditing('new');
      navigate('/savings');
    }
  }, [params]);

  const movements = useMemo(
    () =>
      data.allTransactions
        .filter((t) => t.kind === 'saving')
        .sort((a, b) => b.date.localeCompare(a.date) || b.created_at.localeCompare(a.created_at))
        .slice(0, 8),
    [data.allTransactions],
  );
  const open = report.accounts.filter((a) => !a.account.archived);
  const archived = report.accounts.filter((a) => a.account.archived);
  const year = new Date().getFullYear();
  const maxBar = Math.max(1, ...report.months.map((m) => Math.abs(m.net)));
  const editingStat = editing && editing !== 'new' ? report.accounts.find((a) => a.account.id === editing.id) : undefined;

  return (
    <>
      <TopBar
        title="Savings"
        right={
          <button className="icon-btn" onClick={() => setEditing('new')} aria-label="New savings account">
            <IconPlus />
          </button>
        }
      />

      {report.accounts.length === 0 ? (
        <div className="card">
          <Empty emoji="🐷" title="No savings accounts yet">
            Make one for every pot you save into – e.g. “Emergency fund”, “Vacation” or “Car”. Money you put into savings is
            not counted as spending.
          </Empty>
          <button className="btn btn-primary btn-block" onClick={() => setEditing('new')}>
            Create a savings account
          </button>
        </div>
      ) : (
        <>
          <section className="card hero">
            <div className="hero-label">Total savings</div>
            <div className="hero-amount save">{formatMoney(report.total)}</div>
            <div className="hero-chips">
              <span className="chip chip-save">{signed(report.thisMonth)} this month</span>
              <span className="chip">
                {signed(report.thisYear, true)} in {year}
              </span>
            </div>
            <div className="hero-actions">
              <button className="btn btn-save" onClick={() => onAdd({ kind: 'saving', direction: 'in' })}>
                ➕ Put in
              </button>
              <button className="btn" onClick={() => onAdd({ kind: 'saving', direction: 'out' })}>
                ➖ Take out
              </button>
            </div>
          </section>

          <section className="card">
            <div className="card-head">
              <h3>Accounts</h3>
              <button className="link" onClick={() => setEditing('new')}>
                + New account
              </button>
            </div>
            <div className="cat-list">
              {open.map((a) => (
                <AccountRow key={a.account.id} stat={a} ownerName={personName(a.account.owner_id)} onClick={() => setEditing(a.account)} />
              ))}
            </div>
            {archived.length > 0 && (
              <details className="archived">
                <summary>{archived.length} archived</summary>
                <div className="cat-list">
                  {archived.map((a) => (
                    <AccountRow key={a.account.id} stat={a} ownerName={personName(a.account.owner_id)} onClick={() => setEditing(a.account)} />
                  ))}
                </div>
              </details>
            )}
          </section>

          {report.thisYear !== 0 && (
            <section className="card">
              <h3>Saved per month in {year}</h3>
              <div className="bars">
                {report.months.map((m) => (
                  <div key={m.month} className="bar-col" title={`${formatMonth(m.month)}: ${signed(m.net)}`}>
                    <span className="bar-stack">
                      <span
                        className={`bar ${m.net < 0 ? 'bar-out' : 'bar-saved'}`}
                        style={{ height: `${(Math.abs(m.net) / maxBar) * 100}%` }}
                      />
                    </span>
                    <span className="bar-label">{formatMonthShort(m.month).slice(0, 1)}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {report.people.length > 0 && (
            <section className="card">
              <h3>Who saved how much</h3>
              {report.people.map((p) => (
                <div key={p.id ?? 'shared'} className="person-row">
                  <Avatar name={personName(p.id)} color={personColor(p.id)} />
                  <span className="grow">
                    <b>{personName(p.id)}</b>
                  </span>
                  <b className="save">{signed(p.net)}</b>
                </div>
              ))}
              <p className="small dim">All-time, without starting balances.</p>
            </section>
          )}

          {movements.length > 0 && (
            <section className="card">
              <div className="card-head">
                <h3>Latest movements</h3>
                <button className="link" onClick={() => navigate('/history?kind=saving')}>
                  History
                </button>
              </div>
              {movements.map((t) => (
                <TxRow key={t.id} tx={t} onClick={() => onOpen(t)} showDate />
              ))}
            </section>
          )}
        </>
      )}

      {editing && (
        <AccountSheet
          account={editing === 'new' ? null : editing}
          stat={editingStat}
          onClose={() => setEditing(null)}
          onAdd={(defaults) => {
            setEditing(null);
            onAdd(defaults);
          }}
        />
      )}
    </>
  );
}

function AccountRow({ stat, ownerName, onClick }: { stat: AccountStat; ownerName: string; onClick: () => void }) {
  const { account, balance, thisMonth } = stat;
  const goal = account.goal_cents;
  return (
    <button className={`cat-row ${account.archived ? 'inactive' : ''}`} onClick={onClick}>
      <CatIcon category={account} size={44} />
      <span className="grow">
        <span className="cat-row-top">
          <span className="cat-row-name">
            {account.name} {account.owner_id && <IconLock className="tx-flag" />}
          </span>
          <b className={balance < 0 ? 'text-danger' : ''}>{formatMoney(balance)}</b>
        </span>
        {goal !== null && <Progress value={Math.max(0, balance)} max={goal} color={account.color} goal />}
        <span className="small dim block">
          {account.owner_id ? ownerName : 'Shared'}
          {goal !== null && ` · ${balance >= goal ? '🎉 goal reached' : `${percent(Math.max(0, balance), goal)}% of ${formatMoney(goal, { whole: true })}`}`}
          {thisMonth !== 0 && ` · ${signed(thisMonth)} this month`}
        </span>
      </span>
    </button>
  );
}

function AccountSheet({
  account,
  stat,
  onClose,
  onAdd,
}: {
  account: SavingsAccount | null;
  stat?: AccountStat;
  onClose: () => void;
  onAdd: (defaults: NewEntryDefaults) => void;
}) {
  const data = useData();
  const toast = useToast();
  const { personName, personColor } = useLookups();
  const isNew = account === null;
  const canEdit = isNew || data.isAdmin || account.owner_id === null || account.owner_id === data.userId;
  const canDelete = !isNew && (data.isAdmin || account.owner_id === data.userId);

  const [name, setName] = useState(account?.name ?? '');
  const [emoji, setEmoji] = useState(account?.emoji ?? '🐷');
  const [color, setColor] = useState(account?.color ?? '#14b8a6');
  const [owner, setOwner] = useState(account?.owner_id ?? 'shared');
  const [goal, setGoal] = useState(account?.goal_cents ? centsToInput(account.goal_cents) : '');
  const [initial, setInitial] = useState(account?.initial_cents ? centsToInput(account.initial_cents) : '');
  const [archived, setArchived] = useState(account?.archived ?? false);
  const [busy, setBusy] = useState(false);

  const ownerOptions = [
    { value: 'shared', label: '🤝 Shared', color: personColor(null) },
    ...data.profiles
      .filter((p) => p.id === data.userId || p.id === account?.owner_id)
      .map((p) => ({ value: p.id, label: p.display_name, color: p.color })),
  ];

  async function save() {
    const goalCents = goal.trim() ? parseAmount(goal) : null;
    const initialCents = initial.trim() ? parseAmount(initial) : 0;
    if (!name.trim()) return toast('Give the account a name', 'error');
    if (goal.trim() && goalCents === null) return toast('The goal is not a valid amount', 'error');
    if (initial.trim() && initialCents === null) return toast('The starting balance is not a valid amount', 'error');
    setBusy(true);
    try {
      await data.saveSavingsAccount({
        id: account?.id,
        name: name.trim(),
        emoji: emoji.trim() || '🐷',
        color,
        owner_id: owner === 'shared' ? null : owner,
        goal_cents: goalCents,
        initial_cents: initialCents ?? 0,
        archived,
      });
      toast(isNew ? 'Savings account created' : 'Saved');
      onClose();
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!account || !confirm(`Delete "${account.name}"?`)) return;
    setBusy(true);
    try {
      await data.deleteSavingsAccount(account.id);
      toast('Deleted');
      onClose();
    } catch (e) {
      toast(errorMessage(e), 'error');
      setBusy(false);
    }
  }

  return (
    <Sheet title={isNew ? 'New savings account' : account.name} onClose={onClose}>
      {stat && (
        <div className="account-summary">
          <div className="account-balance save">{formatMoney(stat.balance)}</div>
          <div className="small dim">
            {stat.account.initial_cents > 0 && <>{formatMoney(stat.account.initial_cents)} at the start · </>}
            {formatMoney(stat.deposited)} put in · {formatMoney(stat.withdrawn)} taken out
          </div>
          {stat.byPerson.length > 0 && (
            <div className="account-people">
              {stat.byPerson.map((p) => (
                <span key={p.id ?? 'shared'} className="chip">
                  <span className="dot" style={{ background: personColor(p.id) }} /> {personName(p.id)} {signed(p.net, true)}
                </span>
              ))}
            </div>
          )}
          {!account?.archived && (
            <div className="hero-actions">
              <button className="btn btn-save" onClick={() => onAdd({ kind: 'saving', direction: 'in', accountId: account!.id })}>
                ➕ Put in
              </button>
              <button className="btn" onClick={() => onAdd({ kind: 'saving', direction: 'out', accountId: account!.id })}>
                ➖ Take out
              </button>
            </div>
          )}
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <fieldset className="stack" disabled={!canEdit || busy}>
          <div className="cat-preview">
            <CatIcon category={{ emoji: emoji.trim() || '🐷', color }} size={56} />
            <input className="input grow" placeholder="Name, e.g. Vacation" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
          </div>

          <div>
            <div className="field-label">Icon</div>
            <div className="emoji-grid">
              {EMOJIS.map((e) => (
                <button type="button" key={e} className={`emoji ${e === emoji ? 'emoji-on' : ''}`} onClick={() => setEmoji(e)}>
                  {e}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="field-label">Color</div>
            <ColorPicker value={color} onChange={setColor} />
          </div>

          <div>
            <div className="field-label">Whose savings</div>
            <Segmented value={owner} onChange={setOwner} options={ownerOptions} />
          </div>

          <div className="row-2">
            <Field label="Goal (optional)">
              <input className="input" inputMode="decimal" placeholder="e.g. 3000" value={goal} onChange={(e) => setGoal(e.target.value)} />
            </Field>
            <Field label="Already saved before">
              <input className="input" inputMode="decimal" placeholder="0" value={initial} onChange={(e) => setInitial(e.target.value)} />
            </Field>
          </div>
          <p className="small dim">
            “Already saved before” is money that was in this account before you started tracking it here – it counts in the
            balance, but not as saving in any month.
          </p>

          {!isNew && (
            <Toggle checked={archived} onChange={setArchived} label="Archived" hint="Hidden when adding entries; history and balance stay" />
          )}
        </fieldset>

        {!canEdit && <p className="meta">This is someone else's personal savings account.</p>}

        <div className="sheet-actions">
          {canDelete && (
            <button type="button" className="btn btn-danger" onClick={remove} disabled={busy}>
              Delete
            </button>
          )}
          {canEdit && (
            <button className="btn btn-primary btn-grow" disabled={busy}>
              {busy ? 'Saving…' : isNew ? 'Create' : 'Save'}
            </button>
          )}
        </div>
      </form>
    </Sheet>
  );
}
