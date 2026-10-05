# Quarantined 2026-08-26 — a key a test run left behind

These two files were written at 06:08 on 2026-08-26 by `npx jest`, not by an operator and
not by the application. Two unit suites (area units, evidence gate) instantiated the real
signature service with no `keyDir`, so it reached this directory, found a key it could not
decrypt, and regenerated the pair — which is how certificate GACP-TH-2569-CAE820 lost the
key it was signed with (fingerprint 47b98a69…, now gone).

They are kept rather than deleted because deleting key material is never the reversible
choice. Nothing depends on them:

  - the app cannot decrypt this private key (bad decrypt with RSA_PRIVATE_KEY_PASSPHRASE),
    which is why it blocked startup;
  - a read-only census of the certificate table found ONE certificate, and it pins
    47b98a69…, not this key (c09bcabf…). This pair has never signed anything that was kept.

Both holes are now closed in code: an existing key is never overwritten in any environment
(signature-service.js `ensureLocalKeys`), and a test run is refused this directory outright
(`_refuseTheBoxKeyUnderTest`). Delete this folder whenever you like.
