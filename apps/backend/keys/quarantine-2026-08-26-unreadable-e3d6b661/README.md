# Quarantined 2026-08-26 10:xx — a key encrypted under a passphrase that no longer exists

Generated at 06:18 on 2026-08-26, fingerprint e3d6b661…, under the OLD development passphrase
fallback:

    devFallback: () => `dev-rsa-passphrase-${process.pid}-${Date.now()}`

That value contained the process id and the clock, so no later process could reproduce it. This
key is therefore unreadable by anything, forever — not by us, not by anyone. `bad decrypt` is the
only answer it can ever give.

It signed nothing. A read-only census of the certificate table taken immediately before this move
found ONE certificate, GACP-TH-2569-CAE820, and it pins 47b98a69… — a different key, destroyed
earlier the same day by a jest run.

Moved rather than deleted because key material is never the thing to delete in a hurry, even when
it is provably useless.

The root cause is fixed: config/dev-signing-passphrase.js now gives a development box a stable,
random, per-machine passphrase stored beside the keys and gitignored, so a key written by one
process opens in the next. See __tests__/unit/dev-signing-passphrase-is-stable.test.js.
