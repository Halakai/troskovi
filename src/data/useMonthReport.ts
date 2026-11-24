import { useEffect, useMemo } from 'react';
import { addMonths, yearOf } from '../lib/dates';
import { monthReport, type MonthReport } from '../lib/stats';
import { useData, useReportInput } from './DataProvider';

/** One month's numbers; loads the years they depend on. */
export function useMonthReport(month: string): { report: MonthReport; loading: boolean } {
  const { ensureYear, yearLoading, settings } = useData();
  const carryFrom = settings.carry_from;

  useEffect(() => {
    ensureYear(yearOf(month));
    ensureYear(yearOf(addMonths(month, -1)));
    // the leftover carried in depends on every month since carrying started
    if (carryFrom) for (let y = yearOf(carryFrom); y < yearOf(month); y++) ensureYear(y);
  }, [month, ensureYear, carryFrom]);

  const input = useReportInput();
  const report = useMemo(() => monthReport(input, month), [input, month]);
  return { report, loading: yearLoading(yearOf(month)) };
}
