# Troškovi 💶

A shared monthly expense tracker for two people. It's an installable web app (PWA): it runs from a home-screen icon on iPhone and Android, hosted for free on GitHub Pages, with the data in Supabase (free tier). When one person adds something, it shows up on the other phone right away.

## Features

- Add an expense or income: amount, category, who paid (a person or **Shared**), date (defaults to today), and an optional note
- Shared and private categories. Deleting a category moves its expenses to **Other**.
- Monthly limits per category. A limit change applies from the current month on, so older months keep their old limits.
- Monthly items for rent, loans, subscriptions and salaries. Each one is added automatically on its day of the month. Until then it counts as *expected*, so a salary that arrives mid-month is already included in "left to spend".
- Monthly report: total spent vs budget, money flow, who spent what, a fair split of shared costs, categories with limits, and fun stats
- Yearly report: month-by-month chart, people, categories against their yearly limits, and highlights
- History browsable by month, with filters for person, type and category
- Roles: the **admin** creates accounts, can edit or delete anything, and can reset passwords. Other users can add entries and edit the ones they added, and they can change their own password.
- Works offline: expenses added without a connection are queued and uploaded later
- Dark mode (automatic, or set manually)

## Stack

React + TypeScript + Vite · Supabase (Postgres, Auth, Realtime) · vite-plugin-pwa · GitHub Actions → GitHub Pages

```
supabase/schema.sql      the whole database: tables, row-level security, admin functions, seed data
src/data/DataProvider    loading, realtime sync, offline queue, all writes
src/lib/stats.ts         monthly and yearly report math (unit-tested)
src/screens/             Month, History, Year, Settings (+ Categories, Monthly items, Accounts)
```

## Setup

### 1. Supabase (database)

1. Create a free project at [supabase.com](https://supabase.com). The EU (Frankfurt) region is a good choice.
2. Open **SQL Editor**, paste in all of [`supabase/schema.sql`](supabase/schema.sql), and click **Run**.
   This creates everything plus the first account: **`david` / `admin`**.
3. Go to **Authentication → Sign In / Providers** and turn **off** "Allow new users to sign up". Accounts are created only by the admin, inside the app.
4. Go to **Project Settings → API Keys** and copy the **Project URL** and the **publishable** (or legacy *anon*) key.

### 2. Run locally

```bash
cp .env.example .env.local     # then fill in the URL + key
npm install
npm run dev                    # opens on http://localhost:5173 (and on your LAN, for testing on a phone)
npm test
```

### 3. Deploy to GitHub Pages

1. Push this folder to a GitHub repository. GitHub Pages is free for public repos, and the Supabase key is safe to be public.
2. Go to **Settings → Pages → Source** and choose **GitHub Actions**.
3. Go to **Settings → Secrets and variables → Actions → Variables** and add `SUPABASE_URL` and `SUPABASE_KEY`.
4. Push to `main`. The workflow tests, builds and deploys to `https://<you>.github.io/<repo>/`.

### 4. Install on the phones

- **iPhone:** open the URL in **Safari**, then tap Share → **Add to Home Screen**
- **Android:** open it in **Chrome**, then tap ⋮ → **Install app** (or **Add to Home screen**)

Sign in as `david` / `admin`, change the password (**Settings → Change my password**), then create the second account (**Settings → Accounts**).

## Notes

- Supabase Auth needs an e-mail address, so a username `ana` is stored as `ana@troskovi.invalid`. The `.invalid` domain can never receive mail. If you change it, change it in both `src/config.ts` and `public._email_for()`.
- Free Supabase projects are paused after about a week with no activity. Daily use keeps the project awake.
- Re-running `schema.sql` is safe: it updates functions and policies and doesn't touch your data.
- Number format: `LOCALE` in `src/config.ts` (`en-IE` → €1,234.56, `hr-HR` → 1.234,56 €).
