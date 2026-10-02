import { describe, expect, it } from 'vitest';
import { defaultDateFor, formatDMY } from './dates';

describe('defaultDateFor', () => {
  it('uses today while looking at the current month', () => {
    expect(defaultDateFor('2026-10', '2026-10-02')).toBe('2026-10-02');
  });
  it('uses the 1st when looking at another month', () => {
    expect(defaultDateFor('2026-09', '2026-10-02')).toBe('2026-09-01');
    expect(defaultDateFor('2025-12', '2026-01-15')).toBe('2025-12-01');
  });
});

describe('formatDMY', () => {
  it('formats as dd/mm/yyyy', () => {
    expect(formatDMY('2026-10-02')).toBe('02/10/2026');
    expect(formatDMY('2026-12-31')).toBe('31/12/2026');
  });
});
