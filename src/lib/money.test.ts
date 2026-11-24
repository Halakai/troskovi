import { describe, expect, it } from 'vitest';
import { centsToInput, parseAmount, parseBalance } from './money';

describe('parseAmount', () => {
  it.each([
    ['12', 1200],
    ['12.5', 1250],
    ['12,5', 1250],
    ['12,50', 1250],
    ['0.99', 99],
    ['1.234,56', 123456],
    ['1,234.56', 123456],
    ['1.234', 123400],
    ['12.345', 1234500],
    ['1.234.567,8', 123456780],
    ['€ 45', 4500],
    [' 7 ', 700],
  ])('%s → %i cents', (input, cents) => {
    expect(parseAmount(input)).toBe(cents);
  });

  it.each(['', 'abc', '0', '-5', '12.3.4', '1.23.456', '1,2,3.4.5', '1.234,567'])('rejects %j', (input) => {
    expect(parseAmount(input)).toBeNull();
  });
});

describe('parseBalance', () => {
  it.each([
    ['812,40', 81240],
    ['1.234,56', 123456],
    ['0', 0],
    ['0,00', 0],
    ['-12,50', -1250],
    ['−€ 300', -30000],
    ['-0', 0],
  ])('%s → %i cents', (input, cents) => {
    expect(parseBalance(input)).toBe(cents);
  });

  it.each(['', '-', 'abc', '--5', '1,2,3.4.5', '0.000'])('rejects %j', (input) => {
    expect(parseBalance(input)).toBeNull();
  });
});

describe('centsToInput', () => {
  it('drops .00 for whole amounts', () => {
    expect(centsToInput(1200)).toBe('12');
    expect(centsToInput(1250)).toBe('12.50');
  });
});
