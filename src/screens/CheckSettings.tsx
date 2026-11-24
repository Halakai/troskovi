import { useState } from 'react';
import { useData } from '../data/DataProvider';
import { errorMessage } from '../supabase';
import type { AppSettings, Wallet } from '../types';
import { WEEKDAYS } from '../lib/dates';
import { useToast } from '../components/Toast';
import { CatIcon, Empty, Field, Segmented, Sheet, Toggle, TopBar, useLookups } from '../components/ui';
import { IconPlus, IconRight } from '../components/Icons';

const EMOJIS = ['🏦', '💳', '💵', '👛', '📱', '🪙', '💶', '🏧'];
const MONDAY_FIRST = [1, 2, 3, 4, 5, 6, 0];
const TIMES = Array.from({ length: 48 }, (_, i) => `${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`);

/** When the weekly balance check is due, and the accounts it asks for. */
export function CheckSettings() {
  const data = useData();
  const toast = useToast();
  const { personName, personColor } = useLookups();
  const [editing, setEditing] = useState<Wallet | 'new' | null>(null);
  const { check_weekday, check_time } = data.settings;

  if (!data.isAdmin) {
    return (
      <>
        <TopBar title="Balance check" back="/checks" />
        <div className="card">
          <Empty emoji="🔒" title="Admins only" />
        </div>
      </>
    );
  }

  const save = async (patch: Partial<AppSettings>) => {
    try {
      await data.saveSettings(patch);
      toast('Saved');
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };

  const isInactive = (w: Wallet) => w.archived || data.profiles.some((p) => p.id === w.owner_id && !p.active);
  const shown = data.wallets.filter((w) => !isInactive(w));
  const archived = data.wallets.filter(isInactive);
  const times = TIMES.includes(check_time) ? TIMES : [...TIMES, check_time].sort();

  const row = (w: Wallet) => (
    <button key={w.id} className={`cat-row ${isInactive(w) ? 'inactive' : ''}`} onClick={() => setEditing(w)}>
      <CatIcon category={{ emoji: w.emoji, color: personColor(w.owner_id) }} size={36} />
      <span className="grow">
        <span className="cat-row-name">{w.owner_id ? personName(w.owner_id) : w.name}</span>
        <span className="small dim block">{w.owner_id ? w.name : 'Shared'}</span>
      </span>
      <IconRight className="dim" />
    </button>
  );

  return (
    <>
      <TopBar
        title="Balance check"
        back="/checks"
        right={
          <button className="icon-btn" onClick={() => setEditing('new')} aria-label="Add account">
            <IconPlus />
          </button>
        }
      />

      <section className="card stack">
        <Toggle
          checked={check_weekday !== null}
          onChange={(on) => save({ check_weekday: on ? 0 : null })}
          label="Ask every week"
          hint="Every admin is asked; the first one to fill it in does it for all"
        />
        {check_weekday !== null && (
          <div className="row-2">
            <Field label="From">
              <select className="input" value={check_weekday} onChange={(e) => save({ check_weekday: Number(e.target.value) })}>
                {MONDAY_FIRST.map((d) => (
                  <option key={d} value={d}>
                    {WEEKDAYS[d]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="At">
              <select className="input" value={check_time} onChange={(e) => save({ check_time: e.target.value })}>
                {times.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        )}
      </section>

      <section className="card">
        <div className="card-head">
          <h3>Accounts & cash</h3>
          <button className="link" onClick={() => setEditing('new')}>
            + Add
          </button>
        </div>
        <div className="cat-list">{shown.map(row)}</div>
        {archived.length > 0 && (
          <details className="archived">
            <summary>{archived.length} archived</summary>
            <div className="cat-list">{archived.map(row)}</div>
          </details>
        )}
      </section>

      <p className="page-note">
        Everything your everyday money is on. Savings accounts don’t belong here. An account you add or archive later isn’t
        counted as a difference.
      </p>

      {editing && <WalletSheet wallet={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function WalletSheet({ wallet, onClose }: { wallet: Wallet | null; onClose: () => void }) {
  const data = useData();
  const toast = useToast();
  const { personColor } = useLookups();
  const isNew = wallet === null;
  const [name, setName] = useState(wallet?.name ?? '');
  const [emoji, setEmoji] = useState(wallet?.emoji ?? '🏦');
  const [owner, setOwner] = useState(wallet ? (wallet.owner_id ?? 'shared') : data.userId);
  const [archived, setArchived] = useState(wallet?.archived ?? false);
  const [busy, setBusy] = useState(false);
  const used = wallet !== null && data.checkItems.some((i) => i.wallet_id === wallet.id);

  const people = data.profiles
    .filter((p) => p.active || p.id === wallet?.owner_id)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));

  async function save() {
    if (!name.trim()) return toast('Give the account a name', 'error');
    setBusy(true);
    try {
      await data.saveWallet({ id: wallet?.id, name: name.trim(), emoji, owner_id: owner === 'shared' ? null : owner, archived });
      toast(isNew ? 'Account added' : 'Saved');
      onClose();
    } catch (e) {
      toast(errorMessage(e), 'error');
      setBusy(false);
    }
  }

  async function remove() {
    if (!wallet || !confirm(`Delete "${wallet.name}"?`)) return;
    setBusy(true);
    try {
      await data.deleteWallet(wallet.id);
      toast('Deleted');
      onClose();
    } catch (e) {
      toast(errorMessage(e), 'error');
      setBusy(false);
    }
  }

  return (
    <Sheet title={isNew ? 'New account' : 'Account'} onClose={onClose}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <Field label="Name">
          <input className="input" placeholder="e.g. Second account" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
        </Field>
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
          <div className="field-label">Whose</div>
          <Segmented
            value={owner}
            onChange={setOwner}
            options={[
              ...people.map((p) => ({ value: p.id, label: p.display_name, color: p.color })),
              { value: 'shared', label: '🤝 Shared', color: personColor(null) },
            ]}
          />
        </div>
        {!isNew && <Toggle checked={archived} onChange={setArchived} label="Archived" hint="Not asked for any more; older checks keep it" />}
        <div className="sheet-actions">
          {!isNew && !used && (
            <button type="button" className="btn btn-danger" onClick={remove} disabled={busy}>
              Delete
            </button>
          )}
          <button className="btn btn-primary btn-grow" disabled={busy}>
            {busy ? 'Saving…' : isNew ? 'Add' : 'Save'}
          </button>
        </div>
      </form>
    </Sheet>
  );
}
