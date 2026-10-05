const {
  normalizeIp,
  extractClientIp,
  getRequestIp,
  attachClientIp,
} = require('../../utils/client-ip');

describe('client-ip utility', () => {
  const originalTrustedProxyRanges = process.env.TRUST_PRIVATE_PROXY_RANGES;
  const originalTrustedProxyIps = process.env.TRUSTED_PROXY_IPS;

  afterEach(() => {
    if (originalTrustedProxyRanges === undefined) {
      delete process.env.TRUST_PRIVATE_PROXY_RANGES;
    } else {
      process.env.TRUST_PRIVATE_PROXY_RANGES = originalTrustedProxyRanges;
    }

    if (originalTrustedProxyIps === undefined) {
      delete process.env.TRUSTED_PROXY_IPS;
    } else {
      process.env.TRUSTED_PROXY_IPS = originalTrustedProxyIps;
    }
  });

  it('normalizes IPv4 with port and IPv6-mapped addresses', () => {
    expect(normalizeIp('203.0.113.9:54321')).toBe('203.0.113.9');
    expect(normalizeIp('::ffff:203.0.113.9')).toBe('203.0.113.9');
    expect(normalizeIp('[2001:db8::10]:443')).toBe('2001:db8::10');
  });

  it('ignores forwarding headers when socket remote is untrusted', () => {
    const req = {
      socket: { remoteAddress: '203.0.113.9' },
      headers: { 'x-forwarded-for': '198.51.100.1' },
    };
    expect(extractClientIp(req)).toBe('203.0.113.9');
  });

  it('resolves right-most non-trusted IP from proxy chain', () => {
    const req = {
      socket: { remoteAddress: '172.20.0.2' }, // trusted proxy hop
      headers: {
        'x-forwarded-for': '198.51.100.10, 172.20.0.3',
      },
    };
    expect(extractClientIp(req)).toBe('198.51.100.10');
  });

  it('resists spoofed left-most XFF values', () => {
    const req = {
      socket: { remoteAddress: '172.20.0.2' }, // trusted proxy hop
      headers: {
        'x-forwarded-for': '1.1.1.1, 198.51.100.77',
      },
    };
    expect(extractClientIp(req)).toBe('198.51.100.77');
  });

  it('returns req.clientIp when already attached by middleware', () => {
    const req = {
      clientIp: '198.51.100.55',
      socket: { remoteAddress: '172.20.0.2' },
      headers: { 'x-forwarded-for': '198.51.100.44' },
    };
    expect(getRequestIp(req)).toBe('198.51.100.55');
  });

  it('attachClientIp keeps legacy req.ip aligned with hardened clientIp', () => {
    const req = {
      socket: { remoteAddress: '172.20.0.2' },
      headers: { 'x-forwarded-for': '198.51.100.88' },
    };

    attachClientIp(req, {}, () => {});

    expect(req.clientIp).toBe('198.51.100.88');
    expect(req.ip).toBe('198.51.100.88');
  });
});
