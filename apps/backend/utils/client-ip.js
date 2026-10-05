const net = require('net');

function normalizeIp(rawValue) {
  if (!rawValue) {
    return null;
  }

  let value = String(rawValue).trim();
  if (!value) {
    return null;
  }

  // RFC 7239 can contain quoted values and an optional for= prefix.
  value = value.replace(/^for=/i, '').trim();
  value = value.replace(/^"(.*)"$/, '$1').trim();

  // "[2001:db8::1]:443" -> "2001:db8::1"
  const bracketedIpv6 = value.match(/^\[([^[\]]+)\](?::\d+)?$/);
  if (bracketedIpv6) {
    value = bracketedIpv6[1];
  }

  // "1.2.3.4:1234" -> "1.2.3.4"
  if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(value)) {
    value = value.slice(0, value.lastIndexOf(':'));
  }

  // "::ffff:1.2.3.4" -> "1.2.3.4"
  if (value.toLowerCase().startsWith('::ffff:')) {
    value = value.slice(7);
  }

  // Strip IPv6 zone index.
  const zoneIndex = value.indexOf('%');
  if (zoneIndex >= 0) {
    value = value.slice(0, zoneIndex);
  }

  return net.isIP(value) ? value : null;
}

function parseXForwardedFor(value) {
  if (!value) {
    return [];
  }

  return String(value)
    .split(',')
    .map((entry) => normalizeIp(entry))
    .filter(Boolean);
}

function parseForwardedHeader(value) {
  if (!value) {
    return [];
  }

  const result = [];
  const entries = String(value).split(',');
  for (const entry of entries) {
    const parts = entry.split(';');
    const forPart = parts.find((part) => String(part).trim().toLowerCase().startsWith('for='));
    if (!forPart) {
      continue;
    }

    const ip = normalizeIp(String(forPart).trim().slice(4));
    if (ip) {
      result.push(ip);
    }
  }
  return result;
}

function parseTrustedProxyIps() {
  const raw = process.env.TRUSTED_PROXY_IPS;
  if (!raw) {
    return new Set();
  }

  return new Set(
    String(raw)
      .split(',')
      .map((item) => normalizeIp(item))
      .filter(Boolean),
  );
}

function isPrivateIpv4(ip) {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) {
    return false;
  }

  return (
    parts[0] === 10 ||
    parts[0] === 127 ||
    (parts[0] === 169 && parts[1] === 254) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168) ||
    (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127)
  );
}

function isPrivateIpv6(ip) {
  const normalized = String(ip).toLowerCase();
  return (
    normalized === '::1' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe80:')
  );
}

function isTrustedProxyIp(ip) {
  if (!ip) {
    return false;
  }

  const trustedProxyIps = parseTrustedProxyIps();
  if (trustedProxyIps.has(ip)) {
    return true;
  }

  const allowPrivateRanges = String(process.env.TRUST_PRIVATE_PROXY_RANGES || 'true')
    .trim()
    .toLowerCase() !== 'false';

  if (!allowPrivateRanges) {
    return false;
  }

  if (net.isIP(ip) === 4) {
    return isPrivateIpv4(ip);
  }
  if (net.isIP(ip) === 6) {
    return isPrivateIpv6(ip);
  }

  return false;
}

function extractClientIp(req) {
  const socketIp = normalizeIp(req?.socket?.remoteAddress || req?.connection?.remoteAddress || null);
  const xForwardedFor = parseXForwardedFor(req?.headers?.['x-forwarded-for']);
  const forwarded = parseForwardedHeader(req?.headers?.forwarded);

  let chain = xForwardedFor;
  if (chain.length === 0) {
    chain = forwarded;
  }
  if (chain.length === 0) {
    const xRealIp = normalizeIp(req?.headers?.['x-real-ip']);
    chain = xRealIp ? [xRealIp] : [];
  }

  if (!socketIp && chain.length === 0) {
    return 'unknown';
  }

  // If request does not come from a trusted proxy, ignore forwarding headers.
  if (!socketIp || !isTrustedProxyIp(socketIp)) {
    return socketIp || chain[chain.length - 1] || 'unknown';
  }

  // Right-to-left walk: pick first non-trusted hop to resist XFF spoofing.
  for (let idx = chain.length - 1; idx >= 0; idx -= 1) {
    const candidate = chain[idx];
    if (!isTrustedProxyIp(candidate)) {
      return candidate;
    }
  }

  return socketIp || chain[0] || 'unknown';
}

function getRequestIp(req) {
  return req?.clientIp || extractClientIp(req);
}

function attachClientIp(req, _res, next) {
  req.clientIp = extractClientIp(req);
  // Keep legacy call sites that still read req.ip consistent with hardened extraction.
  try {
    Object.defineProperty(req, 'ip', {
      configurable: true,
      enumerable: true,
      value: req.clientIp,
      writable: false,
    });
  } catch (_error) {
    // Non-blocking: middleware can still use req.clientIp/getRequestIp.
  }
  next();
}

module.exports = {
  normalizeIp,
  parseXForwardedFor,
  parseForwardedHeader,
  isTrustedProxyIp,
  extractClientIp,
  getRequestIp,
  attachClientIp,
};
