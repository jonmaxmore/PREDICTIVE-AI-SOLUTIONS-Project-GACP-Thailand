#!/usr/bin/env bash
# Single entry point for the flow-proof harness. See apps/web-app/flow-proof/README.md.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../apps/web-app"
exec node flow-proof/run.mjs "$@"
