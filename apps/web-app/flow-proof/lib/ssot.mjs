/**
 * Pulls route/role constants out of the app's own SSOT files instead of
 * hand-typing a second copy here (the project rules 3.6). The source files
 * (`src/lib/constants/auth-routes.ts`, `src/lib/constants/canonical-roles.ts`)
 * are plain `export const NAME = 'value'` / string-array declarations with no
 * JSX and no other imports — regex extraction is used instead of a real TS
 * module load so this harness has zero extra runtime requirement (no
 * `--experimental-strip-types`, no ts-node) beyond plain `node`. If a name is
 * not found this throws (fail closed) rather than falling back to a guessed
 * literal — a route SSOT this harness cannot read is a reason to stop, not to
 * duplicate the value.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const WEB_APP_ROOT = path.resolve(__dirname, '..', '..');

function readSource(relPath) {
  const abs = path.join(WEB_APP_ROOT, relPath);
  if (!fs.existsSync(abs)) {
    throw new Error(`ssot.mjs: source file missing — ${relPath} (looked at ${abs})`);
  }
  return fs.readFileSync(abs, 'utf8');
}

function extractStringConst(source, name, fileLabel) {
  const re = new RegExp(`export const ${name}\\s*=\\s*'([^']*)'`);
  const m = source.match(re);
  if (!m) throw new Error(`ssot.mjs: could not find "export const ${name} = '...'" in ${fileLabel}`);
  return m[1];
}

const authRoutesSrc = readSource('src/lib/constants/auth-routes.ts');
export const AUTH_ROUTES = {
  HEALTH_LOGIN_ROUTE: extractStringConst(authRoutesSrc, 'HEALTH_LOGIN_ROUTE', 'auth-routes.ts'),
  PROVIDER_LOGIN_ROUTE: extractStringConst(authRoutesSrc, 'PROVIDER_LOGIN_ROUTE', 'auth-routes.ts'),
  REGISTER_ROUTE: extractStringConst(authRoutesSrc, 'REGISTER_ROUTE', 'auth-routes.ts'),
  HEALTH_DASHBOARD_ROUTE: extractStringConst(authRoutesSrc, 'HEALTH_DASHBOARD_ROUTE', 'auth-routes.ts'),
  PROVIDER_DASHBOARD_ROUTE: extractStringConst(authRoutesSrc, 'PROVIDER_DASHBOARD_ROUTE', 'auth-routes.ts'),
};

/** First entry of tailwind.config.cjs `fontFamily.sans` — the expected primary body typeface. */
export function expectedPrimaryFont() {
  const src = readSource('tailwind.config.cjs');
  const m = src.match(/fontFamily:\s*\{[\s\S]*?sans:\s*\[\s*'([^']+)'/);
  if (!m) throw new Error('ssot.mjs: could not find fontFamily.sans[0] in tailwind.config.cjs');
  return m[1];
}

/** `:root { ... }` custom-property block from globals.css, as a Map(name -> raw value string). */
export function rootDesignTokens() {
  const src = readSource('src/styles/globals.css');
  const rootMatch = src.match(/:root\s*\{([\s\S]*?)\n\s*\}/);
  if (!rootMatch) throw new Error('ssot.mjs: could not find ":root { ... }" block in globals.css');
  const body = rootMatch[1];
  const tokens = new Map();
  const lineRe = /--([a-z0-9-]+):\s*([^;]+);/gi;
  let m;
  while ((m = lineRe.exec(body))) {
    tokens.set(`--${m[1]}`, m[2].trim());
  }
  return tokens;
}
