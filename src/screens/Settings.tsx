import { useEffect, useState } from 'react';
import { useData, type ExportData } from '../data/DataProvider';
import { backupJson, entriesCsv, saveFile } from '../lib/export';
import { errorMessage } from '../supabase';
import type { ThemePref } from '../lib/theme';
import { navigate } from '../lib/router';
import { BUILD_TIME } from '../lib/pwa';
import { useToast } from '../components/Toast';
import { addMonths, currentMonth, formatDMY, formatMonth, monthOf, monthStart, todayISO } from '../lib/dates';
import { Avatar, ColorPicker, Field, Segmented, Sheet, Toggle, TopBar } from '../components/ui';
import { IconDownload, IconRight } from '../components/Icons';

interface Props {
  theme: ThemePref;
  setTheme: (t: ThemePref) => void;
  onSignOut: () => void;
}

export function Settings({ theme, setTheme, onSignOut }: Props) {
  const data = useData();
  const me = data.me!;
  const [sheet, setSheet] = useState<'password' | 'profile' | 'carry' | 'export' | null>(null);
  const carryFrom = data.settings.carry_from;

  return (
    <>
      <TopBar title="Settings" back="/" />

      <section className="card">
        <div className="person-row">
          <Avatar name={me.display_name} color={me.color} size={48} />
          <span className="grow">
            <b className="big">{me.display_name}</b>
            <span className="dim small block">
              @{me.username}
              {me.is_admin && <span className="badge">Admin</span>}
            </span>
          </span>
        </div>
        <div className="menu">
          <button className="menu-item" onClick={() => setSheet('password')}>
            🔑 Change my password <IconRight />
          </button>
          {data.isAdmin && (
            <button className="menu-item" onClick={() => setSheet('profile')}>
              ✏️ Edit my username & name <IconRight />
            </button>
          )}
        </div>
      </section>

      <section className="card">
        <h3>Appearance</h3>
        <Segmented<ThemePref>
          value={theme}
          onChange={setTheme}
          options={[
            { value: 'system', label: 'Auto' },
            { value: 'light', label: '☀️ Light' },
            { value: 'dark', label: '🌙 Dark' },
          ]}
        />
      </section>

      <section className="card">
        <h3>Shared setup</h3>
        <div className="menu">
          <button className="menu-item" onClick={() => navigate('/settings/categories')}>
            🏷️ Expense categories & monthly limits <IconRight />
          </button>
          <button className="menu-item" onClick={() => navigate('/settings/categories?kind=income')}>
            💼 Income categories <IconRight />
          </button>
          <button className="menu-item" onClick={() => navigate('/settings/recurring')}>
            🔁 Monthly items (rent, loan, salary, savings…) <IconRight />
          </button>
          <button className="menu-item" onClick={() => navigate('/savings')}>
            🐷 Savings accounts <IconRight />
          </button>
          <button className="menu-item" onClick={() => setSheet('carry')}>
            <span>
              💶 Leftover money
              <span className="dim small block">
                {carryFrom ? `Carried into the next month since ${formatMonth(monthOf(carryFrom))}` : 'Every month starts from zero'}
              </span>
            </span>
            <IconRight />
          </button>
        </div>
      </section>

      {data.isAdmin && (
        <section className="card">
          <h3>Admin</h3>
          <div className="menu">
            <button className="menu-item" onClick={() => navigate('/settings/users')}>
              👥 Accounts – create, edit, reset passwords <IconRight />
            </button>
          </div>
        </section>
      )}

      <section className="card">
        <h3>Your data</h3>
        <div className="menu">
          <button className="menu-item" onClick={() => setSheet('export')}>
            <span>
              💾 Export & backup
              <span className="dim small block">All entries for Excel, or a full backup file</span>
            </span>
            <IconRight />
          </button>
        </div>
      </section>

      <button className="btn btn-ghost btn-block" onClick={onSignOut}>
        Sign out
      </button>

      <section className="card card-tip small">
        <b>Install on your phone</b>
        <br />
        iPhone: open in Safari → Share → <i>Add to Home Screen</i>.
        <br />
        Android: open in Chrome → ⋮ → <i>Add to Home screen / Install app</i>.
        <div className="dim" style={{ marginTop: 8 }}>
          {data.live ? '🟢 Live – changes from others appear instantly' : '⚪ Not connected right now'}
          {BUILD_TIME && (
            <>
              <br />
              Version from {new Date(BUILD_TIME).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}
            </>
          )}
        </div>
      </section>

      {sheet === 'password' && <PasswordSheet onClose={() => setSheet(null)} />}
      {sheet === 'profile' && <MyProfileSheet onClose={() => setSheet(null)} />}
      {sheet === 'carry' && <CarrySheet onClose={() => setSheet(null)} />}
      {sheet === 'export' && <ExportSheet onClose={() => setSheet(null)} />}
    </>
  );
}

function PasswordSheet({ onClose }: { onClose: () => void }) {
  const { changeMyPassword } = useData();
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false);
  const mismatch = repeat.length > 0 && next !== repeat;

  async function save() {
    if (next.length < 4) return toast('The new password needs at least 4 characters', 'error');
    if (next !== repeat) return toast("The new passwords don't match", 'error');
    setBusy(true);
    try {
      await changeMyPassword(current, next);
      toast('Password changed');
      onClose();
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet title="Change password" onClose={onClose}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <Field label="Current password">
          <input className="input" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
        </Field>
        <Field label="New password">
          <input className="input" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required />
        </Field>
        <Field label="Repeat new password" hint={mismatch ? <span className="text-danger">Doesn't match</span> : undefined}>
          <input className="input" type="password" autoComplete="new-password" value={repeat} onChange={(e) => setRepeat(e.target.value)} required />
        </Field>
        <button className="btn btn-primary btn-block" disabled={busy}>
          {busy ? 'Saving…' : 'Change password'}
        </button>
      </form>
    </Sheet>
  );
}

function MyProfileSheet({ onClose }: { onClose: () => void }) {
  const { me, adminUpdateUser } = useData();
  const toast = useToast();
  const [username, setUsername] = useState(me!.username);
  const [name, setName] = useState(me!.display_name);
  const [color, setColor] = useState(me!.color);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await adminUpdateUser({ id: me!.id, username, displayName: name, isAdmin: true, active: true, color });
      toast('Saved – use the new username next time you sign in');
      onClose();
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet title="My account" onClose={onClose}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <Field label="Username (for signing in)">
          <input className="input" autoCapitalize="none" autoCorrect="off" value={username} onChange={(e) => setUsername(e.target.value)} required />
        </Field>
        <Field label="Display name">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} required maxLength={40} />
        </Field>
        <div>
          <div className="field-label">My color</div>
          <ColorPicker value={color} onChange={setColor} />
        </div>
        <button className="btn btn-primary btn-block" disabled={busy}>
          {busy ? 'Saving…' : 'Save'}
        </button>
      </form>
    </Sheet>
  );
}

function CarrySheet({ onClose }: { onClose: () => void }) {
  const { settings, saveSettings } = useData();
  const toast = useToast();
  const now = currentMonth();
  const [on, setOn] = useState(settings.carry_from !== null);
  const [from, setFrom] = useState(settings.carry_from ? monthOf(settings.carry_from) : now);
  const [busy, setBusy] = useState(false);

  // the last two years to choose from (plus the stored month, if it's older)
  const months = Array.from({ length: 24 }, (_, i) => addMonths(now, -i));
  if (!months.includes(from)) months.push(from);

  async function save() {
    setBusy(true);
    try {
      await saveSettings({ carry_from: on ? monthStart(from) : null });
      toast('Saved');
      onClose();
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet title="Leftover money" onClose={onClose}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <p className="small dim">
          Money that's left at the end of a month doesn't disappear from the bank – so it can start the next month. It
          shows in the month overview as “Left over from …” and is added to what's left to spend. It isn't income, so
          income totals stay as they are. A month that ends below zero carries the minus too.
        </p>
        <Toggle checked={on} onChange={setOn} label="Carry leftover into the next month" />
        {on && (
          <Field label="Starting with" hint={`${formatMonth(from)} starts from zero; what's left of it goes into ${formatMonth(addMonths(from, 1))}, and so on.`}>
            <select className="input" value={from} onChange={(e) => setFrom(e.target.value)}>
              {months.map((m) => (
                <option key={m} value={m}>
                  {formatMonth(m)}
                </option>
              ))}
            </select>
          </Field>
        )}
        <button className="btn btn-primary btn-block" disabled={busy}>
          {busy ? 'Saving…' : 'Save'}
        </button>
      </form>
    </Sheet>
  );
}

function ExportSheet({ onClose }: { onClose: () => void }) {
  const { fetchEverything } = useData();
  const toast = useToast();
  const [data, setData] = useState<ExportData | null>(null);
  const [error, setError] = useState<string | null>(null);

  // load everything first: iPhones only open the share sheet right after a tap, not after a download
  useEffect(() => {
    let alive = true;
    fetchEverything()
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(errorMessage(e)));
    return () => {
      alive = false;
    };
  }, [fetchEverything]);

  async function save(kind: 'csv' | 'json') {
    if (!data) return;
    const day = todayISO();
    const result =
      kind === 'csv'
        ? await saveFile(`troskovi-${day}.csv`, 'text/csv', entriesCsv(data))
        : await saveFile(`troskovi-backup-${day}.json`, 'application/json', backupJson(data));
    if (result === 'downloaded') toast('Saved to your downloads');
  }

  const first = data?.transactions.reduce<string | null>((m, t) => (!m || t.date < m ? t.date : m), null);

  return (
    <Sheet title="Export & backup" onClose={onClose}>
      <div className="stack">
        <p className="small dim">
          Everything is kept safely online, but a copy of your own never hurts – and the table opens in Excel, Google
          Sheets or Python.
        </p>
        <div className="card-tip notice">
          {error ? (
            <span className="text-danger">{error}</span>
          ) : data ? (
            <>
              <b>{data.transactions.length}</b> entries{first && ` since ${formatDMY(first)}`}, {data.categories.length}{' '}
              categories, {data.recurring.length} monthly items – ready.
            </>
          ) : (
            'Getting everything from the server…'
          )}
        </div>
        <button className="btn btn-primary btn-block" disabled={!data} onClick={() => save('csv')}>
          <IconDownload /> Entries as a table (CSV for Excel)
        </button>
        <button className="btn btn-ghost btn-block" disabled={!data} onClick={() => save('json')}>
          <IconDownload /> Full backup (JSON)
        </button>
        <p className="small dim">
          The table has one row per entry: date, type, amount, category, subcategory, person, note… If Excel puts
          everything in one column, open it with Data → From Text/CSV. The backup has everything – also categories,
          limits, monthly items and savings accounts.
        </p>
      </div>
    </Sheet>
  );
}
