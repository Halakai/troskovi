import { describe, expect, it } from 'vitest';
import { addDays, defaultDateFor, formatDMY, formatRange } from './dates';

describe('defaultDateFor', () => {
  it('uses today while looking at the current month', () => {
    expect(defaultDateFor('2026-10', '2026-10-02')).toBe('2026-10-02');
  });
  it('uses the 1st when looking at another month', () => {
    expect(defaultDateFor('2026-09', '2026-10-02')).toBe('2026-09-01');
    expect(defaultDateFor('2025-12', '2026-01-15')).toBe('2025-12-01');
  });
});

describe('addDays', () => {
  it('crosses months and years', () => {
    expect(addDays('2026-11-29', 7)).toBe('2026-12-06');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
  });
});

describe('formatRange', () => {
  it('names the month once when both days are in it', () => {
    expect(formatRange('2026-11-15', '2026-11-22')).toBe('15 – 22 Nov');
    expect(formatRange('2026-11-29', '2026-12-06')).toBe('29 Nov – 6 Dec');
    expect(formatRange('2026-11-22', '2026-11-22')).toBe('22 Nov');
  });
});

describe('formatDMY', () => {
  it('formats as dd/mm/yyyy', () => {
    expect(formatDMY('2026-10-02')).toBe('02/10/2026');
    expect(formatDMY('2026-12-31')).toBe('31/12/2026');
  });
});
