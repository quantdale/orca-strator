# Orca-Strator install/uninstall controller safety helper (Change 026).
#
# Invoked by the NSIS installer/uninstaller (installer.nsh). Policy:
#   exit 0 : no live controller, stale owner, OR provably idle (safe)
#   exit 2 : a live controller exists but safety cannot be proven
#   exit 3 : graceful shutdown was accepted but the process did not exit
#   exit 4 : live controller still owns ACTIVE CAMPAIGNS (never disturbed)
#   exit 5 : graceful shutdown request was not accepted
#
# This helper never force-kills anything and never acts on PID metadata alone:
# termination only ever happens through the controller's own authenticated
# graceful-shutdown contract, proven by real process exit.
param([string]$Mode = "check")
$ErrorActionPreference = "Stop"

$dataDir = Join-Path $env:LOCALAPPDATA 'Orca-Strator'
$lockPath = Join-Path $dataDir 'controller.lock'
if (-not (Test-Path $lockPath)) { exit 0 }

try {
  $lock = Get-Content $lockPath -Raw | ConvertFrom-Json
} catch {
  exit 0 # unreadable/corrupt lock is reclaimed by the next controller start
}
if ($lock.service -ne 'orca-controller') { exit 0 }

$ownerPid = 0
try { $ownerPid = [int]$lock.pid } catch { exit 0 }
$alive = $false
try {
  Get-Process -Id $ownerPid -ErrorAction Stop | Out-Null
  $alive = $true
} catch {}
if (-not $alive) { exit 0 } # stale owner; safe

if (-not $lock.controlToken -or -not $lock.endpoint) { exit 2 }

$headers = @{ 'x-orca-control-token' = $lock.controlToken }
try {
  $resp = Invoke-WebRequest -UseBasicParsing -Headers $headers `
    -Uri "$($lock.endpoint)/api/system/lifecycle" -TimeoutSec 5
} catch {
  exit 2
}
if ($resp.StatusCode -ne 200) { exit 2 }

try {
  $state = ($resp.Content | ConvertFrom-Json).state
} catch {
  exit 2
}
if ($state -ne 'idle') { exit 4 }

if ($Mode -ne 'stop') { exit 0 }

try {
  Invoke-WebRequest -UseBasicParsing -Method Post -Headers $headers `
    -ContentType 'application/json' -Body '{}' `
    -Uri "$($lock.endpoint)/api/system/shutdown" -TimeoutSec 5 | Out-Null
} catch {
  exit 5
}

$deadline = (Get-Date).AddSeconds(25)
while ((Get-Date) -lt $deadline) {
  try {
    Get-Process -Id $ownerPid -ErrorAction Stop | Out-Null
  } catch {
    exit 0 # real process exit observed; ownership release follows
  }
  Start-Sleep -Milliseconds 300
}
exit 3
