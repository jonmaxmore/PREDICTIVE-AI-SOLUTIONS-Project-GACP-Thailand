/**
 * Lightweight, REAL design-token/layout checks run in the live page — not a
 * pixel-diff tool. Each check reads the actual rendered DOM/CSSOM via
 * page.evaluate() and compares it to values pulled from the app's own source
 * (globals.css / tailwind.config.cjs, via lib/ssot.mjs) — never a hardcoded
 * duplicate of the token values (the project rules 3.6).
 *
 * Scope, deliberately kept small ("ใช้เท่าที่ทำได้จริง อย่าเกินตัว"):
 *   1. token parity  — a curated set of core CSS custom properties on
 *      :root, live vs. source.
 *   2. primary font  — computed body font-family vs. tailwind's font-sans[0].
 *   3. horizontal overflow — scrollWidth vs clientWidth, at whatever
 *      viewport the page was captured at (checked at desktop AND mobile
 *      widths by the caller).
 *   4. collapsed interactive elements — visible buttons/links with a
 *      zero-area bounding box (a cheap, real "broken control" signal).
 */
import { rootDesignTokens, expectedPrimaryFont } from './ssot.mjs';

export const CORE_TOKENS = ['--primary', '--background', '--foreground', '--card', '--border', '--destructive', '--radius'];

export async function runDesignCheck(page) {
  const sourceTokens = rootDesignTokens();
  const expectedFont = expectedPrimaryFont();

  const live = await page.evaluate((tokenNames) => {
    const rootStyle = getComputedStyle(document.documentElement);
    const tokens = {};
    for (const name of tokenNames) tokens[name] = rootStyle.getPropertyValue(name).trim();

    const bodyFont = getComputedStyle(document.body).fontFamily;

    const docEl = document.documentElement;
    const overflowX = docEl.scrollWidth > docEl.clientWidth + 4;
    const overflowPx = docEl.scrollWidth - docEl.clientWidth;

    const interactive = Array.from(document.querySelectorAll('button, a[href], input, select, textarea'));
    const collapsed = [];
    for (const el of interactive) {
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) {
        collapsed.push({
          tag: el.tagName.toLowerCase(),
          text: (el.textContent || '').trim().slice(0, 60),
        });
      }
    }

    return { tokens, bodyFont, overflowX, overflowPx, interactiveCount: interactive.length, collapsed };
  }, CORE_TOKENS);

  const tokenMismatches = [];
  for (const name of CORE_TOKENS) {
    const expected = sourceTokens.get(name);
    const actual = live.tokens[name];
    if (expected === undefined) continue; // token not defined in this build's globals.css — nothing to compare
    if (expected !== actual) tokenMismatches.push({ token: name, expected, actual: actual || '(empty)' });
  }

  const fontOk = live.bodyFont.toLowerCase().includes(expectedFont.toLowerCase());

  return {
    tokenMismatches,
    tokenChecked: CORE_TOKENS.length,
    fontOk,
    expectedFont,
    actualFont: live.bodyFont,
    overflowX: live.overflowX,
    overflowPx: live.overflowPx,
    collapsedInteractive: live.collapsed,
    interactiveCount: live.interactiveCount,
    pass: tokenMismatches.length === 0 && fontOk && !live.overflowX && live.collapsed.length === 0,
  };
}
