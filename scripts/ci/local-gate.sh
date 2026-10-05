#!/usr/bin/env bash
# local-gate — gate ชั้นเบาที่รันได้ทุกเครื่อง (dev box หรือเครื่อง staging)
#
# ไม่มี GitHub Actions ให้รอ: operator ตัดสิน 2026-08-14 ว่าไม่จ่ายค่า Actions
# ⇒ hosted runner ใช้ไม่ได้อย่างถาวรจนกว่าจะมีคำสั่งใหม่ (the change log 2026-08-14)
# gate เต็มของโปรเจกต์วันนี้ = `scripts/ci/full-gate.sh` บนเครื่อง staging
# (runbook: docs/operations/runbooks/full-gate-on-staging.md · รายการ check ที่นับว่า
# "full gate" = scripts/ci/full-gate-checks.txt ซึ่งเป็น SSOT ของทั้ง runner และ
# probe gate-attestation) — สคริปต์นี้คือชั้นที่รันก่อนหน้านั้น ไม่ใช่ตัวแทนของมัน
#
# ครอบ:   banned-terms · mojibake · green-mask assertions · probe-gate registry (กอง ci)
#         และ (เมื่อตั้ง LOCAL_GATE_FULL=1) full unit suite
# ไม่ครอบ: integration บน Postgres จริง (R-R2-1 — ต้องมี DATABASE_URL + DB จริง),
#         E2E/visual, gitleaks deep scan ทั้ง history (full-gate: secret-scan-deep)
#         ⇒ ผล PASS ของสคริปต์นี้ "ไม่ใช่" หลักฐานเทียบเท่า full-gate — งานที่แตะ apps/
#           ต้องมี attestation `evidence/gate/<sha>.json` จาก full-gate บนเครื่อง staging
#           (probe `gate-attestation` เป็นตัวตรวจว่ามีจริงและตรง SHA)
set -u
cd "$(git rev-parse --show-toplevel)"
fail=0
step() {
  local name="$1"; shift
  echo ""; echo "===== [local-gate] ${name} ====="
  if "$@"; then echo "[local-gate] ${name}: PASS"; else echo "[local-gate] ${name}: FAIL"; fail=1; fi
}

step banned-terms   node scripts/ci/check-banned-terms.js
step mojibake       node scripts/ci/check-mojibake-encoding.js
step green-mask     node scripts/ci/check-green-mask-assertions.js
step probe-gate     node scripts/ci/probe-gate.js
# deploy-drift no longer has its own step here. While it was parked as
# manual-until it ran above as report-only; since 2026-08-14 the registry marks
# it `ci`, so probe-gate runs it BLOCKING as part of the ci set — a second
# invocation here would just double the network calls and print the verdict
# twice.

if [ "${LOCAL_GATE_FULL:-0}" = "1" ]; then
  step unit-suite bash -c 'cd apps/backend && npx jest --ci --silent'
else
  echo ""; echo "[local-gate] unit-suite: SKIPPED (ตั้ง LOCAL_GATE_FULL=1 เพื่อรันเต็ม — ต้อง pnpm install ก่อน)"
fi

echo ""
if [ "$fail" -eq 0 ]; then
  echo "[local-gate] RESULT: PASS (ภายในขอบเขตที่ครอบเท่านั้น — ดูหัวไฟล์)"
else
  echo "[local-gate] RESULT: FAIL"
fi
exit "$fail"
