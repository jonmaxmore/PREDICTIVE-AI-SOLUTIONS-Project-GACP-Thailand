/**
 * Prometheus metrics registry.
 *
 * Exposes Node/process default metrics plus a thin bridge over the in-memory
 * application metrics in shared/metrics.js, in the Prometheus text exposition
 * format (Content-Type: text/plain; version=0.0.4). Served at GET /metrics and
 * scraped by the monitoring stack (prometheus container).
 *
 * NOTE: the existing /api/metrics endpoint keeps returning JSON for the admin
 * dashboard — this module is purely additive.
 */
const client = require('prom-client');
const appMetrics = require('./metrics');

const register = new client.Registry();
register.setDefaultLabels({ service: 'gacp-backend' });

// Node.js + process default metrics (CPU, memory, event loop lag, GC, handles).
// Standard names (process_*, nodejs_*) — no prefix, so off-the-shelf dashboards work.
client.collectDefaultMetrics({ register });

// ── Application-level gauges, bridged from the in-memory metrics store ──
const httpRequestsTotal = new client.Gauge({
  name: 'gacp_backend_http_requests_total',
  help: 'Total HTTP requests received since process start',
  registers: [register],
});
const errorsTotal = new client.Gauge({
  name: 'gacp_backend_errors_total',
  help: 'Total recorded application errors since process start',
  registers: [register],
});
const dbOperationsTotal = new client.Gauge({
  name: 'gacp_backend_db_operations_total',
  help: 'Total database operations since process start',
  registers: [register],
});
const dbSlowQueriesTotal = new client.Gauge({
  name: 'gacp_backend_db_slow_queries_total',
  help: 'Total slow database queries since process start',
  registers: [register],
});
const socketioConnections = new client.Gauge({
  name: 'gacp_backend_socketio_connections',
  help: 'Current Socket.IO connections',
  registers: [register],
});
const uptimeSeconds = new client.Gauge({
  name: 'gacp_backend_uptime_seconds',
  help: 'Process uptime in seconds',
  registers: [register],
});

// ── Read witness (spec 2026-09-30-remove-workspace-mode §3.1) ──
// Incremented by services/holder-read-witness.js when a health request reads a
// holder-bearing model whose where holds no holder fragment registered (by
// value) in that request; the matching log line carries model, op, route and
// principal. Name as the spec gives
// it (the R1 staging walk checks it stays at 0). Labels are code-defined
// strings only (Prisma model name, read op), so cardinality is bounded.
const healthReadUnscopedTotal = new client.Counter({
  name: 'health_read_unscoped_total',
  help: 'Health-principal reads of a holder-bearing model whose where held no holder fragment registered in the request',
  labelNames: ['model', 'op'],
  registers: [register],
});

/**
 * Refresh the application gauges from the in-memory store. Called right before
 * each scrape so the exposition reflects current counters. Wrapped so a metrics
 * failure can never break the scrape endpoint.
 */
function refreshAppMetrics() {
  try {
    const m = appMetrics.getMetrics();
    httpRequestsTotal.set(m.requests?.total || 0);
    errorsTotal.set(m.errors?.count || 0);
    dbOperationsTotal.set(m.database?.operations || 0);
    dbSlowQueriesTotal.set(m.database?.slowQueries || 0);
    socketioConnections.set(m.socketIO?.connections || 0);
    uptimeSeconds.set(Math.floor((m.uptime || 0) / 1000));
  } catch {
    // Never let metrics collection break the scrape endpoint.
  }
}

module.exports = { register, refreshAppMetrics, client, healthReadUnscopedTotal };
