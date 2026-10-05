-- Pre-deploy data check for GACP
-- 1. Check consentedpdpa columns
SELECT 'PDPA_CHECK' as check_name,
  count(*) as total_rows,
  count("consentedPDPA") as camelcase_non_null,
  count(consentedpdpa) as lowercase_non_null
FROM applications;

-- 2. Check certification columns
SELECT 'CERT_PURPOSE_CHECK' as check_name,
  count("certificationPurpose") as camelcase_non_null,
  count(certificationpurpose) as lowercase_non_null
FROM applications;

SELECT 'PREV_CERT_CHECK' as check_name,
  count("previousCertNumber") as camelcase_non_null,
  count(previouscertnumber) as lowercase_non_null
FROM applications;

-- 3. Check for duplicate gatewayRef
SELECT 'GATEWAY_REF_DUPES' as check_name, count(*) as dupe_count FROM (
  SELECT "gatewayRef" FROM payment_transactions
  WHERE "gatewayRef" IS NOT NULL
  GROUP BY "gatewayRef" HAVING count(*) > 1
) t;

-- 4. Check for duplicate qrCode
SELECT 'QR_CODE_DUPES' as check_name, count(*) as dupe_count FROM (
  SELECT "qrCode" FROM trace_qr_security
  WHERE "qrCode" IS NOT NULL
  GROUP BY "qrCode" HAVING count(*) > 1
) t;

-- 5. Check user verification columns
SELECT 'USER_VERIFY_CHECK' as check_name,
  count("verificationStatus") as status_non_null,
  count("verificationNote") as note_non_null,
  count("verificationAttempts") as attempts_non_null
FROM users;
