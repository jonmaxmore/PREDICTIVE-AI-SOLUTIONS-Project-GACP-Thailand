#!/usr/bin/env bash
# stripe-keys-ready — BLOCKED until a real Stripe test-mode API call succeeds
# with the key from env. NEVER passes without the live round-trip (the project rules 3.2).
source "$(dirname "$0")/_lib.sh"
[ -z "${STRIPE_SECRET_KEY:-}" ] && blocked "operator:stripe-keys — STRIPE_SECRET_KEY absent from env"
CODE=$(curl -s -o /dev/null -w '%{http_code}' -u "$STRIPE_SECRET_KEY:" https://api.stripe.com/v1/balance || echo 000)
[ "$CODE" = "200" ] && pass "Stripe test-mode /v1/balance HTTP 200"
blocked "operator:stripe-keys — /v1/balance HTTP $CODE"
