/**
 * Real login flows, sharing the exact selectors the repo's own e2e helpers
 * use against the live login pages (not guessed):
 *   health:   apps/web-app/e2e/helpers/auth.ts (#identifier / #password)
 *   provider: apps/web-app/e2e-walkthrough/role-routes.ts providerLoginAuth()
 *             (#provider-id / #provider-password)
 */
import { AUTH_ROUTES } from './ssot.mjs';
import { gotoAndLog, fillIfPresent, clickByRole } from './ui-helpers.mjs';

export async function loginFarmer(page, ctx, { identifier, password }) {
  await gotoAndLog(page, ctx, AUTH_ROUTES.HEALTH_LOGIN_ROUTE, 'เปิดหน้า login เกษตรกร');
  const filledId = await fillIfPresent(page, ctx, 'identifier', identifier, 'เลขบัตรประชาชน');
  const filledPw = await fillIfPresent(page, ctx, 'password', password, 'รหัสผ่าน');
  if (!filledId || !filledPw) {
    return { ok: false, reason: 'ไม่พบช่องกรอก #identifier/#password บนหน้า login ที่โหลดจริง' };
  }
  const clicked = await clickByRole(page, ctx, 'button', /เข้าสู่ระบบ|sign in|login/i, 'submit login เกษตรกร');
  if (!clicked) return { ok: false, reason: 'ไม่พบปุ่ม submit บนหน้า login' };
  try {
    await page.waitForURL((url) => url.pathname.startsWith(AUTH_ROUTES.HEALTH_DASHBOARD_ROUTE), { timeout: 15_000 });
    return { ok: true, reason: `redirect ไปถึง ${page.url()}` };
  } catch {
    return { ok: false, reason: `ไม่ redirect ไป ${AUTH_ROUTES.HEALTH_DASHBOARD_ROUTE} ภายใน 15s — URL สุดท้าย ${page.url()}` };
  }
}

export async function loginProvider(page, ctx, { identifier, password }, roleLabel) {
  await gotoAndLog(page, ctx, AUTH_ROUTES.PROVIDER_LOGIN_ROUTE, `เปิดหน้า login ${roleLabel}`);
  const filledId = await fillIfPresent(page, ctx, 'provider-id', identifier, 'เลขประจำตัวเจ้าหน้าที่');
  const filledPw = await fillIfPresent(page, ctx, 'provider-password', password, 'รหัสผ่าน');
  if (!filledId || !filledPw) {
    return { ok: false, reason: 'ไม่พบช่องกรอก #provider-id/#provider-password บนหน้า login ที่โหลดจริง' };
  }
  const clicked = await clickByRole(page, ctx, 'button', /เข้าสู่ระบบ|sign in|login/i, `submit login ${roleLabel}`);
  if (!clicked) return { ok: false, reason: 'ไม่พบปุ่ม submit บนหน้า login' };
  try {
    await page.waitForURL((url) => /\/provider\//.test(url.pathname) && !/\/auth\//.test(url.pathname), { timeout: 15_000 });
    return { ok: true, reason: `redirect ไปถึง ${page.url()}` };
  } catch {
    return { ok: false, reason: `ไม่ redirect ไป /provider/* ภายใน 15s — URL สุดท้าย ${page.url()}` };
  }
}
