#requires -Version 5.1
<#
.SYNOPSIS
    Iter 29 (2026-05-16) production deploy harness — PowerShell counterpart.

.DESCRIPTION
    Mirrors scripts/deploy-prod.sh for Windows-hosted deploys (lab / staging-
    on-Windows / dev-on-Windows targeting a remote production over compose
    or k8s context). The exit codes match the bash version so CI orchestration
    can branch on the same numbers regardless of which shell ran.

    Phases:
      1. Pre-flight  (NODE_ENV, secrets-catalog gate, capture pre-deploy SHA)
      2. Build       (pnpm install --frozen-lockfile + pnpm build)
      3. Migrate     (npx prisma migrate deploy in apps/backend)
      4. Orchestrator notify
      5. Smoke       (poll /api/health)
      6. Post-deploy verify

    Exit codes:
      0   success
      10  pre-flight failed
      20  build failed
      30  migration failed
      40  smoke failed
      50  orchestrator notify failed
      60  post-deploy verify failed

.PARAMETER NodeEnv
    Required NODE_ENV value (must be "production").

.PARAMETER DeployTarget
    One of: compose | k8s | none. systemd is not supported on Windows.

.PARAMETER HealthUrl
    Liveness URL to poll after restart. Defaults to http://localhost:8000/api/health.

.PARAMETER ReadyUrl
    Readiness URL to poll. Defaults to http://localhost:8000/api/health/ready.

.PARAMETER RollbackShaFile
    Where to write the pre-deploy git SHA for emergency rollback.

.PARAMETER SkipBuild
    Set to skip pnpm install + build (image already prebuilt).

.PARAMETER SkipMigrate
    Set to skip prisma migrate deploy (already run out-of-band).
#>

[CmdletBinding()]
param(
    [string]$NodeEnv = $env:NODE_ENV,
    [ValidateSet('compose', 'k8s', 'none')] [string]$DeployTarget = 'compose',
    [string]$HealthUrl = 'http://localhost:8000/api/health',
    [string]$ReadyUrl  = 'http://localhost:8000/api/health/ready',
    [string]$ComposeFile = 'docker-compose.production.yml',
    [string]$KubeDeployment = '',
    [string]$KubeNamespace = 'default',
    [string]$RollbackShaFile = (Join-Path $env:TEMP 'gacp-rollback-sha'),
    [switch]$SkipBuild,
    [switch]$SkipMigrate
)

$ErrorActionPreference = 'Stop'

# Resolve repo root from this script's location so the caller's cwd does not matter.
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot  = Resolve-Path (Join-Path $ScriptDir '..')
Set-Location $RepoRoot

$Ts = Get-Date -Format 'yyyyMMdd-HHmmss'

function Write-Log  { param([string]$Msg) Write-Host ("[{0}] [deploy-prod] {1}" -f (Get-Date -Format HH:mm:ss), $Msg) }
function Write-Ok   { param([string]$Msg) Write-Host ("[{0}] [deploy-prod] OK:   {1}" -f (Get-Date -Format HH:mm:ss), $Msg) -ForegroundColor Green }
function Write-Fail { param([string]$Msg) Write-Host ("[{0}] [deploy-prod] FAIL: {1}" -f (Get-Date -Format HH:mm:ss), $Msg) -ForegroundColor Red }

# ─── 1/6 Pre-flight ──────────────────────────────────────────────────────
Write-Log 'phase 1/6 pre-flight checks'

if ($NodeEnv -ne 'production') {
    Write-Fail "NODE_ENV must be 'production' (got '$NodeEnv')"
    Write-Fail "  refusing to deploy: pass -NodeEnv production or set `$env:NODE_ENV"
    exit 10
}
Write-Ok "  NODE_ENV=production"

$SecretsScript = Join-Path $RepoRoot 'apps/backend/scripts/check-secrets.js'
if (-not (Test-Path $SecretsScript)) {
    Write-Fail "secrets validator missing: $SecretsScript"
    Write-Fail '  this script is required (Iter 27) — refusing to deploy'
    exit 10
}

# Run check-secrets.js and capture exit code. PowerShell's `&` runs the
# native binary; the exit code lives in $LASTEXITCODE afterwards.
& node $SecretsScript "--env=production"
$secretsRc = $LASTEXITCODE
if ($secretsRc -ne 0) {
    Write-Fail "secret catalog readiness check FAILED (exit $secretsRc)"
    Write-Fail '  fix the listed secrets in your production secret manager, then re-run'
    exit 10
}
Write-Ok '  secrets catalog: all required secrets present'

# Capture pre-deploy git SHA for rollback. If git is unavailable in CI, log
# and continue — image-tag based rollback is the fallback path.
$preDeploySha = ''
if (Get-Command git -ErrorAction SilentlyContinue) {
    try {
        $preDeploySha = (& git rev-parse HEAD).Trim()
    } catch {
        $preDeploySha = ''
    }
}
if ($preDeploySha) {
    Set-Content -Path $RollbackShaFile -Value $preDeploySha -Encoding ASCII
    Write-Ok "  pre-deploy SHA captured to $RollbackShaFile ($preDeploySha)"
} else {
    Write-Log '  pre-deploy SHA: not available; rollback must use image tag'
}

# ─── 2/6 Build ───────────────────────────────────────────────────────────
Write-Log 'phase 2/6 build'

if ($SkipBuild) {
    Write-Log '  SkipBuild set — assuming a CI-prebuilt image already pushed'
} else {
    if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
        Write-Fail 'pnpm not on PATH and -SkipBuild was not specified'
        exit 20
    }
    & pnpm install --frozen-lockfile
    if ($LASTEXITCODE -ne 0) { Write-Fail 'pnpm install --frozen-lockfile failed'; exit 20 }
    & pnpm build
    if ($LASTEXITCODE -ne 0) { Write-Fail 'pnpm build failed'; exit 20 }
    Write-Ok '  build complete'
}

# ─── 3/6 Database migrations ─────────────────────────────────────────────
Write-Log 'phase 3/6 database migrations'

if ($SkipMigrate) {
    Write-Log '  SkipMigrate set — migrations assumed already applied'
} else {
    Push-Location (Join-Path $RepoRoot 'apps/backend')
    try {
        & npx --no-install prisma migrate deploy
        if ($LASTEXITCODE -ne 0) {
            Write-Fail 'prisma migrate deploy failed'
            Write-Fail '  inspect: cd apps/backend ; npx prisma migrate status'
            exit 30
        }
    } finally {
        Pop-Location
    }
    Write-Ok '  migrations applied'
}

# ─── 4/6 Orchestrator notify ─────────────────────────────────────────────
Write-Log "phase 4/6 orchestrator notify (target=$DeployTarget)"

switch ($DeployTarget) {
    'none' {
        Write-Log '  DeployTarget=none — caller manages restarts; skipping'
    }
    'compose' {
        if (-not (Test-Path $ComposeFile)) { Write-Fail "compose file not found: $ComposeFile"; exit 50 }
        if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { Write-Fail 'docker not on PATH'; exit 50 }
        & docker compose -f $ComposeFile up -d --no-deps backend frontend
        if ($LASTEXITCODE -ne 0) { Write-Fail 'docker compose up -d --no-deps failed'; exit 50 }
        Write-Ok '  compose rolling restart issued'
    }
    'k8s' {
        if (-not $KubeDeployment) { Write-Fail 'DeployTarget=k8s but -KubeDeployment is empty'; exit 50 }
        if (-not (Get-Command kubectl -ErrorAction SilentlyContinue)) { Write-Fail 'kubectl not on PATH'; exit 50 }
        & kubectl -n $KubeNamespace rollout restart "deployment/$KubeDeployment"
        if ($LASTEXITCODE -ne 0) { Write-Fail 'kubectl rollout restart failed'; exit 50 }
        & kubectl -n $KubeNamespace rollout status "deployment/$KubeDeployment" --timeout=300s
        if ($LASTEXITCODE -ne 0) { Write-Fail 'kubectl rollout status timed out'; exit 50 }
        Write-Ok "  k8s: deployment/$KubeDeployment rolled out"
    }
}

# ─── 5/6 Smoke test ──────────────────────────────────────────────────────
Write-Log 'phase 5/6 smoke test'
Start-Sleep -Seconds 3

$smokeOk = $false
for ($i = 1; $i -le 10; $i++) {
    try {
        $r = Invoke-WebRequest -Uri $HealthUrl -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop
        if ($r.StatusCode -eq 200) { $smokeOk = $true; break }
    } catch {
        # swallow + retry
    }
    Write-Log "  /api/health attempt $i failed; retrying in 3s"
    Start-Sleep -Seconds 3
}
if (-not $smokeOk) {
    Write-Fail "smoke test failed: $HealthUrl did not return 200 after 10 attempts"
    Write-Fail '  rollback: see docs/operations/rollback-runbook-2026-05-16.md'
    exit 40
}
Write-Ok "  liveness /api/health = 200"

$readyOk = $false
for ($i = 1; $i -le 5; $i++) {
    try {
        $r = Invoke-WebRequest -Uri $ReadyUrl -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop
        if ($r.StatusCode -eq 200) { $readyOk = $true; break }
    } catch {
        # swallow + retry
    }
    Start-Sleep -Seconds 3
}
if ($readyOk) {
    Write-Ok '  readiness /api/health/ready = 200'
} else {
    Write-Log '  readiness /api/health/ready did NOT return 200 within ~15s'
    Write-Log '  deploy is live but the orchestrator should treat this instance as not-yet-routable'
}

# ─── 6/6 Post-deploy verify ──────────────────────────────────────────────
Write-Log 'phase 6/6 post-deploy verify'
$versionUrl = $HealthUrl -replace '/health$', '/version'
try {
    $versionResp = Invoke-WebRequest -Uri $versionUrl -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop
    Write-Log "  deployed version payload: $($versionResp.Content)"
} catch {
    Write-Log '  /api/version not reachable; skipping version log'
}

Write-Ok "deploy complete at $Ts"
Write-Log "  pre-deploy SHA: $preDeploySha"
Write-Log "  rollback file:  $RollbackShaFile"
Write-Log '  to roll back:   see docs/operations/rollback-runbook-2026-05-16.md'

exit 0
