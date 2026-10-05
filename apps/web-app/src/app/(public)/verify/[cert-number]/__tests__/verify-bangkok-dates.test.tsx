/**
 * UXUI-11 / CODE-X1 (audit 2026-09-17) — the public verify page prints Bangkok
 * dates, whatever clock zone the frontend container runs in.
 *
 * The page is a server component, and the frontend image sets no TZ, so it
 * renders on UTC. Production showed "ตรวจสอบเมื่อ 16/9/2569 21:28:41" at 04:28
 * on 17 Sep in Bangkok, and a certificate issued between 00:00 and 06:59 in
 * Bangkok showed the day before as its issue date.
 *
 * This machine runs on Asia/Bangkok, and assigning process.env.TZ inside jest
 * does not reach ICU. So the test gives Date's locale formatters the default a
 * UTC process has: any call that names no time zone is formatted in UTC. A call
 * that names Asia/Bangkok is untouched. That is exactly the difference between
 * the container and this laptop, and nothing else.
 */

import { renderToStaticMarkup } from 'react-dom/server';

jest.mock('next/headers', () => ({
  headers: async () => ({
    get: (name: string) =>
      name === 'x-forwarded-host' ? 'demo.gacpth.com' : name === 'x-forwarded-proto' ? 'https' : null,
  }),
}));

import PublicCertVerifyPage from '../page';

// 01:30 on 17 Sep 2569 in Bangkok; still 16 Sep in UTC.
const AFTER_MIDNIGHT_BKK = '2026-09-16T18:30:00.000Z';

type LocaleMethod = 'toLocaleString' | 'toLocaleDateString' | 'toLocaleTimeString';

function runLikeAUtcProcess() {
  for (const method of ['toLocaleString', 'toLocaleDateString', 'toLocaleTimeString'] as LocaleMethod[]) {
    const original = Date.prototype[method];
    jest
      .spyOn(Date.prototype, method)
      .mockImplementation(function (this: Date, locales?: Intl.LocalesArgument, options?: Intl.DateTimeFormatOptions) {
        return original.call(this, locales, { timeZone: 'UTC', ...(options ?? {}) });
      });
  }
}

function stubVerifyResponse(data: Record<string, unknown>) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ success: true, verified: true, valid: true, data }),
  }) as unknown as typeof fetch;
}

async function renderPage() {
  const element = await PublicCertVerifyPage({
    params: Promise.resolve({ 'cert-number': 'GACP-TH-2569-A3F7B2' }),
  });
  return renderToStaticMarkup(element);
}

const CERT = {
  farmName: 'ฟาร์มสมุนไพรบ้านนา',
  province: 'เชียงใหม่',
  cropTypes: ['ขมิ้นชัน'],
  issueDate: AFTER_MIDNIGHT_BKK,
  expiryDate: '2029-09-16T18:30:00.000Z',
  standards: ['GACP'],
};

beforeEach(() => {
  runLikeAUtcProcess();
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe('public verify page — Bangkok dates on a UTC server', () => {
  it('the simulated process really formats zone-less calls in UTC', () => {
    expect(new Date(AFTER_MIDNIGHT_BKK).toLocaleDateString('en-US', { day: 'numeric' })).toBe('16');
    expect(
      new Date(AFTER_MIDNIGHT_BKK).toLocaleDateString('en-US', { day: 'numeric', timeZone: 'Asia/Bangkok' }),
    ).toBe('17');
  });

  it('prints the issue and expiry dates as the Bangkok day', async () => {
    stubVerifyResponse({ certificate: CERT, verifiedAt: AFTER_MIDNIGHT_BKK });
    const html = await renderPage();
    expect(html).toContain('17 กันยายน 2569');
    expect(html).toContain('17 กันยายน 2572');
    expect(html).not.toContain('16 กันยายน');
  });

  it('prints the backend verification time in Bangkok time', async () => {
    stubVerifyResponse({ certificate: CERT, verifiedAt: AFTER_MIDNIGHT_BKK });
    const html = await renderPage();
    expect(html).toContain('ตรวจสอบเมื่อ 17/9/2569 01:30:00');
    expect(html).not.toContain('16/9/2569');
  });

  it('prints the page\'s own clock in Bangkok time when the backend sends no time', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask', 'setTimeout', 'setInterval'] });
    jest.setSystemTime(new Date(AFTER_MIDNIGHT_BKK));
    stubVerifyResponse({ certificate: CERT });
    const html = await renderPage();
    expect(html).toContain('ตรวจสอบเมื่อ 17/9/2569 01:30:00');
  });

  it('an unparseable backend time shows the page\'s own Bangkok clock, never "Invalid Date"', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask', 'setTimeout', 'setInterval'] });
    jest.setSystemTime(new Date(AFTER_MIDNIGHT_BKK));
    stubVerifyResponse({ certificate: CERT, verifiedAt: 'not-a-date' });
    const html = await renderPage();
    expect(html).not.toContain('Invalid Date');
    expect(html).toContain('ตรวจสอบเมื่อ 17/9/2569 01:30:00');
  });
});
