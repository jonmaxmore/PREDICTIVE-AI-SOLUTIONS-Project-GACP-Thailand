/**
 * Test harness for gacp/no-raw-color (Phase A5 §4.3 enforcement).
 *
 * Uses ESLint's Linter API directly (flat-config mode) instead of
 * RuleTester — RuleTester's flat-config support has parser-options
 * quirks for JSX in v9.x, but the Linter API works the same way ESLint
 * does at runtime, which is what we actually care about.
 *
 * Run: pnpm --filter web-app exec node eslint-rules/no-raw-color.test.js
 *
 * Exit 0 = all tests pass; non-zero = at least one test failed.
 */

'use strict';

const { Linter } = require('eslint');
const rule = require('./no-raw-color');

const linter = new Linter({ configType: 'flat' });

const baseConfig = {
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
  plugins: { gacp: { rules: { 'no-raw-color': rule } } },
  rules: { 'gacp/no-raw-color': 'error' },
};

function lint(code) {
  return linter.verify(code, baseConfig);
}

const cases = [
  // ── Valid ─────────────────────────────────────────────────────
  { code: '<div className="bg-blue-700 text-white" />', expectErrors: 0, label: 'palette tokens OK' },
  { code: '<div className="border-slate-300 ring-emerald-500" />', expectErrors: 0, label: 'palette tokens OK' },
  { code: '<div style={{ color: "var(--primary)" }} />', expectErrors: 0, label: 'CSS var OK' },
  { code: '<div style={{ color: "rgb(255 255 255)" }} />', expectErrors: 0, label: 'rgb() OK' },
  { code: '<svg fill="#FF0000" />', expectErrors: 0, label: 'SVG fill exempt' },
  { code: '<rect fill="#00FF00" stroke="#0000FF" />', expectErrors: 0, label: 'SVG primitives exempt' },
  { code: 'const x = "#abcdef";', expectErrors: 0, label: 'plain JS string OK' },

  // ── Invalid ───────────────────────────────────────────────────
  { code: '<div className="bg-[#0b1f3a]" />', expectErrors: 1, expectMsgId: 'tailwindArbitrary', label: 'TW arbitrary bg-[#hex]' },
  { code: '<div className="text-[#1e3a8a]/50" />', expectErrors: 1, expectMsgId: 'tailwindArbitrary', label: 'TW arbitrary with opacity' },
  { code: '<div className="border-[#fff]" />', expectErrors: 1, expectMsgId: 'tailwindArbitrary', label: 'TW arbitrary border' },
  { code: '<div className="bg-[#0b1f3a] text-[#1e3a8a]" />', expectErrors: 2, label: 'two TW arbitrary in one className' },
  { code: 'cn(`bg-[#000000]`)', expectErrors: 1, expectMsgId: 'tailwindArbitrary', label: 'template literal in cn()' },
  { code: '<div style={{ color: "#FF0000" }} />', expectErrors: 1, expectMsgId: 'inlineStyle', label: 'inline style hex' },
  { code: '<div style={{ backgroundColor: "#abcdef" }} />', expectErrors: 1, expectMsgId: 'inlineStyle', label: 'inline style hex (bgcolor)' },
];

let pass = 0;
let fail = 0;
for (const c of cases) {
  const messages = lint(c.code);
  const errCount = messages.length;
  const ok = errCount === c.expectErrors &&
    (!c.expectMsgId || (errCount > 0 && messages[0].messageId === c.expectMsgId));
  if (ok) {
    pass += 1;
    // eslint-disable-next-line no-console -- test-runner diagnostic
    console.log(`${c.label}`);
  } else {
    fail += 1;
    console.error(`${c.label}`);
    console.error(`    code:           ${c.code}`);
    console.error(`    expected count: ${c.expectErrors}${c.expectMsgId ? ` + msg=${c.expectMsgId}` : ''}`);
    console.error(`    got:            ${errCount}  ${JSON.stringify(messages.map((m) => m.messageId))}`);
  }
}

// eslint-disable-next-line no-console -- test-runner final summary
console.log('');
// eslint-disable-next-line no-console -- test-runner final summary
console.log(`Total: ${pass} passed, ${fail} failed`);
if (fail > 0) {
  process.exit(1);
}
