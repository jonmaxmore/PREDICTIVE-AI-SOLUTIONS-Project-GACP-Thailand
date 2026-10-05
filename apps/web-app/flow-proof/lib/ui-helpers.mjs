/**
 * Small real-click helpers shared by steps.mjs. Every helper performs an
 * actual Playwright action (fill/check/click) against the live DOM — none of
 * these simulate an outcome. Failures are caught and logged via
 * ctx.logAction(...) rather than thrown, so one missing field on a page this
 * harness has not been able to render live (protected pages, in this
 * sandbox) does not abort the whole step before it can record why.
 */

export async function gotoAndLog(page, ctx, url, label) {
  const startUrl = page.url();
  try {
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {});
    ctx.logAction({
      type: 'goto',
      detail: `${label}: ${startUrl} -> ${url} (landed ${page.url()}, HTTP ${resp ? resp.status() : 'n/a'})`,
      ok: true,
    });
    return resp;
  } catch (e) {
    ctx.logAction({ type: 'goto', detail: `${label}: ${url}`, ok: false, error: e.message });
    return null;
  }
}

/** Fills a text-like input by CSS id, only if it exists and is visible. Returns true if filled. */
export async function fillIfPresent(page, ctx, id, value, label) {
  const locator = page.locator(`#${id}`).first();
  const count = await locator.count().catch(() => 0);
  if (count === 0) return false;
  const visible = await locator.isVisible().catch(() => false);
  if (!visible) return false;
  try {
    await locator.fill(value, { timeout: 5000 });
    ctx.logAction({ type: 'fill', detail: `${label || id} = ${id.toLowerCase().includes('password') ? '••••' : JSON.stringify(value)}`, ok: true });
    return true;
  } catch (e) {
    ctx.logAction({ type: 'fill', detail: `${label || id}`, ok: false, error: e.message });
    return false;
  }
}

export async function checkIfPresent(page, ctx, id, label) {
  const locator = page.locator(`#${id}`).first();
  const count = await locator.count().catch(() => 0);
  if (count === 0) return false;
  try {
    await locator.check({ timeout: 5000 });
    ctx.logAction({ type: 'check', detail: label || id, ok: true });
    return true;
  } catch (e) {
    ctx.logAction({ type: 'check', detail: label || id, ok: false, error: e.message });
    return false;
  }
}

/** Clicks the first visible button/link matching an accessible-name regex. Returns true if clicked. */
export async function clickByRole(page, ctx, role, namePattern, label) {
  const locator = page.getByRole(role, { name: namePattern }).first();
  const count = await locator.count().catch(() => 0);
  if (count === 0) return false;
  const visible = await locator.isVisible().catch(() => false);
  if (!visible) return false;
  try {
    await locator.click({ timeout: 8000 });
    ctx.logAction({ type: 'click', detail: label || `${role} matching ${namePattern}`, ok: true });
    return true;
  } catch (e) {
    ctx.logAction({ type: 'click', detail: label || `${role} matching ${namePattern}`, ok: false, error: e.message });
    return false;
  }
}

/**
 * Drives a multi-screen wizard: on each screen, fills every known field id
 * that is currently visible, then clicks the submit button if visible
 * (stopping there), else the "next" button if visible (continuing), else
 * gives up. Real clicks/fills only — see file header. Sequential by design
 * (one shared page/session, screens must be filled/advanced in order).
 */
export async function driveWizard(page, ctx, { fieldValues, checkboxIds = [], submitName, nextName, maxScreens = 8 }) {
  for (let screen = 1; screen <= maxScreens; screen += 1) {
    for (const [id, value] of Object.entries(fieldValues)) {
      await fillIfPresent(page, ctx, id, value);
    }
    for (const id of checkboxIds) {
      await checkIfPresent(page, ctx, id);
    }
    const submitted = await clickByRole(page, ctx, 'button', submitName, `submit (screen ${screen})`);
    if (submitted) return { submitted: true, screensVisited: screen };
    const advanced = await clickByRole(page, ctx, 'button', nextName, `next (screen ${screen})`);
    if (!advanced) {
      ctx.logAction({ type: 'wizard', detail: `stopped at screen ${screen}: no submit/next button visible`, ok: false, error: 'no submit or next control found', blocked: true });
      return { submitted: false, screensVisited: screen };
    }
    await page.waitForTimeout(400);
  }
  ctx.logAction({ type: 'wizard', detail: `hit maxScreens=${maxScreens} without reaching submit`, ok: false, error: 'wizard longer than expected', blocked: true });
  return { submitted: false, screensVisited: maxScreens };
}
