import { useEffect, useMemo } from 'react';
import { useData, useReportInput } from '../data/DataProvider';
import { yearReport } from '../lib/stats';
import { formatMonth, formatMonthShort } from '../lib/dates';
import { formatMoney, percent } from '../lib/money';
import { navigate } from '../lib/router';
import { CatIcon, Empty, TopBar, YearSwitcher, useLookups } from '../components/ui';
import { CategoryList, PeopleBlock } from './Overview';

interface Props {
  year: number;
  setYear: (y: number) => void;
  openMonth: (m: string) => void;
}

export function Year({ year, setYear, openMonth }: Props) {
  const data = useData();
  const { ensureYear } = data;
  const { category, personName } = useLookups();

  useEffect(() => ensureYear(year), [year, ensureYear]);

  const input = useReportInput();
  const report = useMemo(() => yearReport(input, year), [input, year]);

  const maxBar = Math.max(1, ...report.months.map((m) => Math.max(m.spent, m.income, m.saved)));
  const hasIncome = report.income > 0;
  const hasSavings = report.months.some((m) => m.saved > 0);
  const people = report.people.filter((p) => p.id !== null);
  const champion = [...report.monthsWon.entries()].sort((a, b) => b[1] - a[1])[0];
  const monthsWithData = report.months.filter((m) => m.spent > 0).length;

  return (
    <>
      <TopBar title={<YearSwitcher year={year} onChange={setYear} />} />

      {report.spent === 0 && report.income === 0 && report.saved === 0 ? (
        <div className="card">
          {data.yearLoading(year) ? <Empty emoji="⏳" title="Loading…" /> : <Empty emoji="📭" title={`No entries in ${year}`} />}
        </div>
      ) : (
        <>
          <section className="card hero">
            <div className="hero-label">Spent in {year}</div>
            <div className="hero-amount">{formatMoney(report.spent, { whole: true })}</div>
            <div className="hero-chips">
              <span className="chip">⌀ {formatMoney(report.averagePerMonth, { whole: true })} / month</span>
              {report.saved !== 0 && (
                <span className="chip chip-save">
                  🐷 {formatMoney(report.saved, { whole: true })} into savings
                  {report.saved > 0 && hasIncome && ` (${percent(report.saved, report.income)}%)`}
                </span>
              )}
              {hasIncome && (
                <span className={`chip ${report.leftOver >= 0 ? 'chip-good' : 'chip-bad'}`}>
                  {report.leftOver >= 0 ? '💶 left over' : '⚠️ short'} {formatMoney(Math.abs(report.leftOver), { whole: true })}
                </span>
              )}
            </div>
          </section>

          <section className="card">
            <h3>Month by month</h3>
            <div className="bars">
              {report.months.map((m) => (
                <button key={m.month} className="bar-col" onClick={() => openMonth(m.month)} title={formatMonth(m.month)}>
                  <span className="bar-stack">
                    {hasIncome && <span className="bar bar-income" style={{ height: `${(m.income / maxBar) * 100}%` }} />}
                    <span className="bar bar-spent" style={{ height: `${(m.spent / maxBar) * 100}%` }} />
                    {hasSavings && <span className="bar bar-saved" style={{ height: `${(Math.max(0, m.saved) / maxBar) * 100}%` }} />}
                  </span>
                  <span className="bar-label">{formatMonthShort(m.month).slice(0, 1)}</span>
                </button>
              ))}
            </div>
            <div className="bars-legend">
              <span>
                <span className="dot" style={{ background: 'var(--accent)' }} /> Spent
              </span>
              {hasIncome && (
                <span>
                  <span className="dot" style={{ background: 'var(--ok)' }} /> Income
                </span>
              )}
              {hasSavings && (
                <span>
                  <span className="dot" style={{ background: 'var(--save)' }} /> Saved
                </span>
              )}
              <span className="dim">Tap a month</span>
            </div>
          </section>

          <section className="card">
            <h3>Who spent what</h3>
            <PeopleBlock people={report.people} total={report.spent} />
            {champion && people.length > 1 && monthsWithData > 1 && (
              <div className="verdict">
                🏆 {personName(champion[0])} out-spent everyone in {champion[1]} of {monthsWithData} months
              </div>
            )}
          </section>

          <section className="card">
            <h3>Categories</h3>
            <p className="small dim card-note">Limits are added up for the {report.elapsedMonths} months so far.</p>
            <CategoryList stats={report.categories} />
          </section>

          {hasIncome && (
            <section className="card">
              <div className="card-head">
                <h3>Income</h3>
                <span className="pos small">+{formatMoney(report.income, { whole: true })}</span>
              </div>
              <CategoryList stats={report.incomeCategories} />
            </section>
          )}

          {report.savings.length > 0 && (
            <section className="card">
              <div className="card-head">
                <h3>Savings</h3>
                <button className="link" onClick={() => navigate('/savings')}>
                  Open savings
                </button>
              </div>
              <div className="cat-list">
                {report.savings.map(({ account, net }) => (
                  <div key={account.id} className="cat-row">
                    <CatIcon category={account} size={36} />
                    <span className="grow cat-row-name">{account.name}</span>
                    <b className="save">
                      {net > 0 ? '+' : '−'}
                      {formatMoney(Math.abs(net), { whole: true })}
                    </b>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="card">
            <h3>Highlights</h3>
            <div className="stat-grid">
              {report.priciest && (
                <div className="stat">
                  <div className="stat-emoji">🔥</div>
                  <div className="stat-label">Priciest month</div>
                  <div className="stat-value">{formatMonthShort(report.priciest.month)}</div>
                  <div className="stat-sub">{formatMoney(report.priciest.spent, { whole: true })}</div>
                </div>
              )}
              {report.cheapest && monthsWithData > 1 && (
                <div className="stat">
                  <div className="stat-emoji">🧊</div>
                  <div className="stat-label">Cheapest month</div>
                  <div className="stat-value">{formatMonthShort(report.cheapest.month)}</div>
                  <div className="stat-sub">{formatMoney(report.cheapest.spent, { whole: true })}</div>
                </div>
              )}
              {report.biggest && (
                <div className="stat">
                  <div className="stat-emoji">💸</div>
                  <div className="stat-label">Biggest expense</div>
                  <div className="stat-value">{formatMoney(report.biggest.amount_cents, { whole: true })}</div>
                  <div className="stat-sub">
                    {category(report.biggest.category_id)?.name} · {personName(report.biggest.person_id)}
                  </div>
                </div>
              )}
              {report.categories[0]?.spent > 0 && (
                <div className="stat">
                  <div className="stat-emoji">{report.categories[0].category.emoji}</div>
                  <div className="stat-label">Top category</div>
                  <div className="stat-value">{percent(report.categories[0].spent, report.spent)}%</div>
                  <div className="stat-sub">{report.categories[0].category.name}</div>
                </div>
              )}
            </div>
          </section>

          <button className="btn btn-ghost btn-block" onClick={() => navigate('/history')}>
            Browse all entries by month
          </button>
        </>
      )}
    </>
  );
}
