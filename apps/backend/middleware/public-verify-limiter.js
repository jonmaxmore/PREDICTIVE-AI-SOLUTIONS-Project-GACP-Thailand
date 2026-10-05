'use strict';

// One definition of the per-IP limit on every public lookup-by-number door.
// New certificate numbers are sequential (TH-GACP 1/2569, 2/2569 ...), so
// walking the register must stay costly: 30 req/IP/min is generous for a
// shopper scanning several QRs and throttles a script. The other half of the
// protection is the minimal response (no farm facts unless the certificate is
// active, applicant name masked).
const { createRateLimiter } = require('./rate-limiter');

const publicVerifyLimiter = createRateLimiter({
    windowMs: 60 * 1000,
    max: 30,
    message: 'Too many verification requests. Please try again in a minute.',
});

module.exports = { publicVerifyLimiter };
