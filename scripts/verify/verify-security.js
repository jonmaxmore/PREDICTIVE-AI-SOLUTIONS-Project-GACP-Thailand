const BASE_URL = process.env.BASE_URL || 'http://localhost/api';

async function verifySecurity() {
  console.log('--- Verifying Security Middleware ---');
  const healthUrl = `${BASE_URL.replace(/\/$/, '')}/health`;

  try {
    const response = await fetch(healthUrl);
    if (!response.ok) {
      throw new Error(`Health endpoint failed with status ${response.status}`);
    }

    const headers = response.headers;
    const expectedHeaders = ['x-dns-prefetch-control', 'x-content-type-options'];
    const missing = expectedHeaders.filter((headerName) => !headers.has(headerName));
    if (missing.length > 0) {
      throw new Error(`Missing security headers: ${missing.join(', ')}`);
    }

    console.log('[verify-security] Helmet headers verified');

    const badRes = await fetch(healthUrl, {
      headers: { Origin: 'http://evil-site.com' },
    });

    if (badRes.headers.get('access-control-allow-origin') === 'http://evil-site.com') {
      throw new Error('CORS failed to block bad origin');
    }

    console.log(`[verify-security] CORS blocked bad origin (status: ${badRes.status})`);
    console.log('[verify-security] PASS');
  } catch (error) {
    console.error('[verify-security] FAIL:', error.message || error);
    process.exitCode = 1;
  }
}

verifySecurity();
