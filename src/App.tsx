import { useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { isConfigured, supabase } from './supabase';
import { DataProvider, useData } from './data/DataProvider';
import { useTheme, type ThemePref } from './lib/theme';
import { navigate, useRoute } from './lib/router';
import { currentMonth, defaultDateFor, todayISO, yearOf } from './lib/dates';
import type { Transaction } from './types';
import { ToastProvider } from './components/Toast';
import { TxSheet } from './components/TxSheet';
import { IconChart, IconGear, IconHome, IconList, IconPlus } from './components/Icons';
import { Login } from './screens/Login';
import { Overview } from './screens/Overview';
import { History } from './screens/History';
import { Year } from './screens/Year';
import { Settings } from './screens/Settings';
import { CategoriesSettings } from './screens/CategoriesSettings';
import { RecurringSettings } from './screens/RecurringSettings';
import { UsersSettings } from './screens/UsersSettings';

export function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [theme, setTheme] = useTheme();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  if (!isConfigured) {
    return (
      <div className="login">
        <div className="login-logo">🔧</div>
        <h1>Almost there</h1>
        <p className="dim">
          Supabase isn't configured. Create <code>.env.local</code> with <code>VITE_SUPABASE_URL</code> and{' '}
          <code>VITE_SUPABASE_KEY</code> (see README).
        </p>
      </div>
    );
  }
  if (session === undefined) return <Splash />;

  return (
    <ToastProvider>
      {session ? (
        <DataProvider key={session.user.id} userId={session.user.id}>
          <Shell theme={theme} setTheme={setTheme} />
        </DataProvider>
      ) : (
        <Login />
      )}
    </ToastProvider>
  );
}

async function signOut() {
  await supabase.auth.signOut({ scope: 'local' });
  navigate('/');
}

function Splash({ text, action }: { text?: string; action?: { label: string; run: () => void } }) {
  return (
    <div className="login">
      <div className="login-logo pulse">💶</div>
      {text && <p className="dim">{text}</p>}
      {action && (
        <button className="btn" onClick={action.run}>
          {action.label}
        </button>
      )}
    </div>
  );
}

function Shell({ theme, setTheme }: { theme: ThemePref; setTheme: (t: ThemePref) => void }) {
  const data = useData();
  const [path, params] = useRoute();
  const [month, setMonth] = useState(currentMonth);
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [sheet, setSheet] = useState<{ tx: Transaction | null; date?: string } | null>(null);

  if (!data.ready) {
    return data.syncError ? (
      <Splash text={data.syncError} action={{ label: 'Try again', run: () => data.refresh() }} />
    ) : (
      <Splash text="Loading…" />
    );
  }
  if (!data.me || !data.me.active) {
    return <Splash text="This account is disabled. Ask the admin to enable it." action={{ label: 'Sign out', run: signOut }} />;
  }

  const open = (tx: Transaction) => setSheet({ tx });
  let screen;
  // screens with the month selector: new entries start in the month being viewed
  let showsMonth = false;
  switch (path) {
    case '/history':
      showsMonth = true;
      screen = <History month={month} setMonth={setMonth} params={params} onOpen={open} />;
      break;
    case '/year':
      screen = (
        <Year
          year={year}
          setYear={setYear}
          openMonth={(m) => {
            setMonth(m);
            navigate('/');
          }}
        />
      );
      break;
    case '/settings':
      screen = <Settings theme={theme} setTheme={setTheme} onSignOut={signOut} />;
      break;
    case '/settings/categories':
      screen = <CategoriesSettings />;
      break;
    case '/settings/recurring':
      screen = <RecurringSettings />;
      break;
    case '/settings/users':
      screen = <UsersSettings />;
      break;
    default:
      showsMonth = true;
      screen = (
        <Overview
          month={month}
          setMonth={(m) => {
            setMonth(m);
            setYear(yearOf(m));
          }}
          onOpen={open}
        />
      );
  }

  const tab = (to: string, label: string, icon: ReactNode, active: boolean) => (
    <button className={`tab ${active ? 'tab-on' : ''}`} onClick={() => navigate(to)}>
      {icon}
      <span>{label}</span>
    </button>
  );

  return (
    <div className="app">
      <main>{screen}</main>
      <nav className="tabbar">
        {tab('/', 'Month', <IconHome />, path === '/')}
        {tab('/history', 'History', <IconList />, path === '/history')}
        <button
          className="fab"
          onClick={() => setSheet({ tx: null, date: showsMonth ? defaultDateFor(month) : todayISO() })}
          aria-label="Add expense"
        >
          <IconPlus width={28} height={28} />
        </button>
        {tab('/year', 'Year', <IconChart />, path === '/year')}
        {tab('/settings', 'Settings', <IconGear />, path.startsWith('/settings'))}
      </nav>
      {sheet && <TxSheet tx={sheet.tx} defaultDate={sheet.date} onClose={() => setSheet(null)} />}
    </div>
  );
}
