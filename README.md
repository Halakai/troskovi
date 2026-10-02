# Troškovi 💶

A shared monthly expense tracker for two people. It's an installable web app (PWA): it runs from a home-screen icon on iPhone and Android, hosted for free on GitHub Pages, with the data in Supabase (free tier). When one person adds something, it shows up on the other phone right away.

## Features

- Add an expense, an income or a savings movement: amount, category (or savings account), who (a person or **Shared**), date (defaults to today, or to the 1st of the month you're looking at), and an optional note
- Separate category lists for expenses and income. Each list has shared and private categories. Deleting a category moves its entries to **Other** / **Other income**.
- Savings accounts (e.g. "Emergency fund", "Vacation"), each with an optional goal and a starting balance. Money put into savings doesn't count as spending, but it does lower "left to spend". Taking money out raises it again.
- Monthly limits per expense category. A limit change applies from the current month on, so older months keep their old limits.
- Monthly items for rent, loans, subscriptions, salaries and savings. Each one is added automatically on its day of the month. Until then it counts as *expected*, so a salary that arrives mid-month is already included in "left to spend".
- Monthly report: total spent vs budget, money flow, who spent what, a fair split of shared costs, categories with limits, income by category, savings, and fun stats
- Yearly report: month-by-month chart, people, expense and income categories, savings per account, and highlights
- History browsable by month, with filters for person, type (expense / income / savings) and category or account
- Roles: the **admin** creates accounts, can edit or delete anything, and can reset passwords. Other users can add entries and edit the ones they added, and they can change their own password.
- Works offline: entries added without a connection are queued and uploaded later
- Updates itself: when a new version is deployed, the app switches to it the next time it's opened, without interrupting an entry in progress. Settings shows the version date.
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
- Re-running `schema.sql` is safe, and it's also how you upgrade: it adds new tables and columns, updates functions and policies, and keeps your data (`npm run db:apply` does it from the terminal).
- Number format: `LOCALE` in `src/config.ts` (`en-IE` → €1,234.56, `hr-HR` → 1.234,56 €).
