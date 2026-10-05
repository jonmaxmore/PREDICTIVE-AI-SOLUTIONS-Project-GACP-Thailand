/**
 * The copyright year is a printed business date, so it reads the Bangkok
 * calendar (operator 2026-09-26), not the server's or viewer's clock zone.
 */

import { describe, expect, it, afterEach, jest } from '@jest/globals';
import { copyrightLine } from '../copyright';

describe('copyrightLine', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('uses the Bangkok year when UTC is still on the previous year', () => {
    jest.useFakeTimers({ now: new Date('2026-12-31T18:00:00Z') });
    expect(copyrightLine('© {year}', 'th')).toBe('© 2570 (2027)');
    expect(copyrightLine('© {year}', 'en')).toBe('© 2027');
  });
});
