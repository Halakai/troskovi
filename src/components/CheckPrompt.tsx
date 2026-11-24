// The weekly balance check asks to be filled in: on opening the app, and as a card on the month screen.
import { useEffect, useState } from 'react';
import { useBalance, useData } from '../data/DataProvider';
import { errorMessage } from '../supabase';
import { checkDue, openPeriods } from '../lib/balance';
import { formatDay, formatDayShort, toISODate, todayISO } from '../lib/dates';
import { formatMoney } from '../lib/money';
import { navigate } from '../lib/router';
import { useToast } from './Toast';
import { Sheet } from './ui';

/** The current time, kept up to date while the app is on the screen. */
function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const tick = () => document.visibilityState === 'visible' && setNow(new Date());
    const timer = setInterval(tick, 30000);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }, []);
  return now;
}

/** When the check that is waiting became due. Only admins are asked; null = nothing is waiting. */
export function useCheckDue(): Date | null {
  const { checks, settings, isAdmin } = useData();
  const now = useNow();
  return isAdmin ? checkDue(checks, settings, now) : null;
}

const laterKey = (userId: string) => `troskovi.check.later.${userId}`;

/** "Later" was pressed today on this phone. */
function isPutOff(userId: string): boolean {
  try {
    return localStorage.getItem(laterKey(userId)) === todayISO();
  } catch {
    return false;
  }
}

/** Doesn't ask again before tomorrow. */
export function putOff(userId: string) {
  try {
    localStorage.setItem(laterKey(userId), todayISO());
  } catch {
    /* it will just ask again */
  }
}

/** `blocked`: something else is open – an entry being edited, or the check itself. */
export function CheckPrompt({ blocked }: { blocked: boolean }) {
  const data = useData();
  const toast = useToast();
  const due = useCheckDue();
  const { periods } = useBalance();
  const [open, setOpen] = useState(false);
  /** asks once each time the app is opened (or comes back to the screen) */
  const [asked, setAsked] = useState(false);
  const { userId, syncedAt } = data;
  const waiting = due !== null && syncedAt !== null && !blocked;

  useEffect(() => {
    const onHide = () => document.visibilityState === 'hidden' && setAsked(false);
    document.addEventListener('visibilitychange', onHide);
    return () => document.removeEventListener('visibilitychange', onHide);
  }, []);

  useEffect(() => {
    if (!waiting || open || asked) return;
    const ask = () => {
      const el = document.activeElement;
      const typing = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement;
      if (document.visibilityState !== 'visible' || typing || document.querySelector('.sheet')) return;
      if (isPutOff(userId)) return;
      setAsked(true);
      setOpen(true);
    };
    ask();
    const timer = setInterval(ask, 2000);
    return () => clearInterval(timer);
  }, [waiting, open, asked, userId]);

  // someone else has done it (or skipped it) in the meantime, or the check was opened another way
  useEffect(() => {
    if (open && !waiting) setOpen(false);
  }, [open, waiting]);

  if (!open || !waiting) return null;

  const later = () => {
    putOff(userId);
    setOpen(false);
    toast('I’ll ask again tomorrow – until then it waits on the month screen', 'info');
  };
  const skip = async () => {
    try {
      await data.saveSettings({ check_skipped_at: new Date().toISOString() });
      setOpen(false);
      toast('Skipped – the next check will cover both weeks');
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };

  const last = periods[periods.length - 1];
  const unsettled = openPeriods(periods).reduce((s, p) => s + p.gap, 0);
  return (
    <Sheet title="🧾 Weekly balance check" onClose={later}>
      {last ? (
        <p>
          Time to compare the app with what’s really on the accounts.
          <span className="dim small block check-prompt-last">
            Last check {formatDayShort(last.check.date)} –{' '}
            {unsettled !== 0 ? (
              <span className={unsettled < 0 ? 'text-danger' : 'pos'}>{formatMoney(unsettled, { sign: true })} still to settle</span>
            ) : (
              'everything matched ✅'
            )}
          </span>
        </p>
      ) : (
        <p>
          Type in what’s really on the accounts right now. This first check sets the starting point – from then on the app can
          tell in which week something went missing.
        </p>
      )}
      <div className="sheet-actions">
        <button className="btn btn-ghost btn-grow" onClick={later}>
          Later
        </button>
        <button
          className="btn btn-primary btn-grow"
          onClick={() => {
            setOpen(false);
            navigate('/checks/new');
          }}
        >
          Fill in
        </button>
      </div>
      {last && (
        <button className="link check-skip" onClick={skip}>
          Skip this week
        </button>
      )}
    </Sheet>
  );
}

/** Stays on the month screen for as long as the check is waiting. */
export function CheckDueCard() {
  const due = useCheckDue();
  if (!due) return null;
  return (
    <button className="card card-tip check-due" onClick={() => navigate('/checks/new')}>
      <span className="check-due-icon">🧾</span>
      <span className="grow">
        <b>Balance check is waiting</b>
        <span className="dim small block">since {formatDay(toISODate(due))}</span>
      </span>
      <span className="btn btn-primary">Fill in</span>
    </button>
  );
}
