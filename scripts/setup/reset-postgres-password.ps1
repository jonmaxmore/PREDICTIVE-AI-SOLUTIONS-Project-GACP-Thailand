# Reset PostgreSQL superuser password by temporarily flipping pg_hba.conf
# to trust auth, then setting a known password.
# Run as Administrator.
# ASCII-only to avoid PowerShell 5.1 parser issues with non-ASCII chars.

$ErrorActionPreference = "Stop"

# Require admin
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
  Write-Host "[FAIL] This script must run as Administrator." -ForegroundColor Red
  Write-Host ""
  Write-Host "How to fix:" -ForegroundColor Yellow
  Write-Host "  1. Press Win + X"
  Write-Host "  2. Click 'Windows PowerShell (Admin)' (NOT 'Windows PowerShell')"
  Write-Host "  3. Click Yes on UAC prompt"
  Write-Host "  4. Re-run the same command in that admin window"
  exit 1
}

$dataDir = "D:\GACP-Data\postgres-native\data"
$pgBin = "D:\PostgreSQL\15\bin"
$psql = "$pgBin\psql.exe"
$hba = "$dataDir\pg_hba.conf"
$hbaBak = "$dataDir\pg_hba.conf.before-reset"

# Random superuser password
$newPass = "GacpSuper$(Get-Random -Maximum 999999)Local"

Write-Host "[1/6] Stop service" -ForegroundColor Cyan
Stop-Service postgresql-x64-15 -Force

Write-Host "[2/6] Backup pg_hba.conf to $hbaBak"
Copy-Item $hba $hbaBak -Force

Write-Host "[3/6] Replace pg_hba.conf with trust auth (temporary)"
$hbaContent = "# TEMPORARY trust auth for password reset only`n"
$hbaContent += "# TYPE  DATABASE  USER  ADDRESS         METHOD`n"
$hbaContent += "local   all       all                   trust`n"
$hbaContent += "host    all       all   127.0.0.1/32    trust`n"
$hbaContent += "host    all       all   ::1/128         trust`n"
Set-Content -Path $hba -Value $hbaContent -Encoding ASCII

Write-Host "[4/6] Start service"
Start-Service postgresql-x64-15
Start-Sleep 3

Write-Host "[5/6] Set new postgres superuser password"
& $psql -h localhost -U postgres -d postgres -c "ALTER USER postgres PASSWORD '$newPass';"
if ($LASTEXITCODE -ne 0) {
  Write-Host "[FAIL] ALTER USER failed - restoring pg_hba.conf and aborting" -ForegroundColor Red
  Copy-Item $hbaBak $hba -Force
  Restart-Service postgresql-x64-15
  exit 1
}

Write-Host "[6/6] Restore pg_hba.conf and restart"
Copy-Item $hbaBak $hba -Force
Restart-Service postgresql-x64-15
Start-Sleep 3

# Save password outside repo
$pwFile = "D:\GACP-Data\.postgres-superuser-password"
$newPass | Out-File $pwFile -Encoding UTF8 -NoNewline
Write-Host ""
Write-Host "[OK] DONE - new postgres superuser password saved at:" -ForegroundColor Green
Write-Host "   $pwFile" -ForegroundColor Yellow
Write-Host ""
Write-Host "   password: $newPass" -ForegroundColor Yellow
Write-Host ""

# Verify
Write-Host "=== verify connection ==="
$env:PGPASSWORD = $newPass
& $psql -h localhost -U postgres -d postgres -c "SELECT version();"
