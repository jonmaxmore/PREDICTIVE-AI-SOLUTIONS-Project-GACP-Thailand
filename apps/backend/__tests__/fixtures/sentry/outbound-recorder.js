'use strict';

/**
 * Preloaded with `node -r` into the child process that
 * sentry-express-envelope.test.js spawns. Records every OUTBOUND TCP connection
 * the process attempts, before any application code runs.
 *
 * Every outbound path Node has — http/https.request, undici `fetch`,
 * tls.connect, net.connect — ends in `net.Socket.prototype.connect`. An inbound
 * request the app serves is an accepted socket and never calls it. So "this list
 * is empty" means "this process opened no connection to anything", which is the
 * claim the off-by-default test makes.
 */
const net = require('net');

const connects = [];
const originalConnect = net.Socket.prototype.connect;

net.Socket.prototype.connect = function recordConnect(...args) {
    const first = args[0];
    const target = Array.isArray(first) ? first[0] : first;
    if (target && typeof target === 'object') {
        connects.push({ host: target.host || target.path || null, port: target.port || null });
    } else {
        connects.push({ host: typeof args[1] === 'string' ? args[1] : null, port: target ?? null });
    }
    return originalConnect.apply(this, args);
};

globalThis.__outboundConnects = connects;
