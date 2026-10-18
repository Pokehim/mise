import { describe, expect, it } from 'vitest';
import { budgetInText } from './generate';

describe('budgetInText', () => {
  it('reads the budget a Brief names in dollars', () => {
    expect(budgetInText('cozy Japandi, under $400, I need a reading corner')).toBe(400);
    expect(budgetInText('a dorm under $ 1,250')).toBe(1250);
  });

  it('finds none in a Brief that names no amount', () => {
    expect(budgetInText('decorate my dorm, cheap')).toBeUndefined();
    expect(budgetInText('$0 please')).toBeUndefined();
  });
});
