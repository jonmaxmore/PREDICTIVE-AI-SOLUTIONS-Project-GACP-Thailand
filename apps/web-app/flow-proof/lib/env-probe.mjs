/**
 * Real reachability probes — no assumptions. Each returns {ok, detail} where
 * `detail` is either a real success message (real HTTP status, real psql
 * output) or the real error text, never a guess.
 */
import http from 'node:http';
import https from 'node:https';
import { probeConnection } from './db.mjs';

export function checkHttp(url, timeoutMs = 5000) {
  return new Promise((resolve) => {
    let u;
    try {
      u = new URL(url);
    } catch (e) {
      resolve({ ok: false, detail: `invalid URL: ${e.message}` });
      return;
    }
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.get(u, { timeout: timeoutMs }, (res) => {
      resolve({ ok: res.statusCode < 500, detail: `HTTP ${res.statusCode}` });
      res.resume();
    });
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, detail: `timeout after ${timeoutMs}ms` }); });
    req.on('error', (e) => resolve({ ok: false, detail: e.message }));
  });
}

/**
 * Runs the three real probes and returns them plus the auto-selected mode,
 * exactly per the work brief's three modes:
 *   (ก) full    — DB reachable AND backend AND frontend reachable
 *   (ข) ui-api  — backend AND frontend reachable, DB not required
 *   (ค) dry-run — backend or frontend NOT reachable ("ระบบยังไม่รัน")
 */
export async function probeAll({ databaseUrl, backendBase, frontendBase }) {
  const [dbProbe, backendProbe, frontendProbe] = await Promise.all([
    Promise.resolve(probeConnection(databaseUrl)),
    checkHttp(`${backendBase.replace(/\/$/, '')}/api/health`),
    checkHttp(frontendBase),
  ]);
  let mode;
  if (dbProbe.ok && backendProbe.ok && frontendProbe.ok) mode = 'full';
  else if (backendProbe.ok && frontendProbe.ok) mode = 'ui-api';
  else mode = 'dry-run';
  return { dbProbe, backendProbe, frontendProbe, mode };
}
