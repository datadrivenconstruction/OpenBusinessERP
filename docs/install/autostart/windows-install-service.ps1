# Install OpenBusinessERP as a Windows service (autostart on boot).
# Uses Windows Task Scheduler - no extra tools required (NSSM optional).
#
# Run this script ONCE as Administrator:
#   powershell -ExecutionPolicy Bypass -File windows-install-service.ps1
#
# To remove later:
#   schtasks /Delete /TN "OpenBusinessERP" /F

$ErrorActionPreference = 'Stop'

# === EDIT THESE PATHS ===
# Where openbusinesserp.exe lives - usually <python-prefix>\Scripts\openbusinesserp.exe
# (older installs may only have the legacy openestimate.exe launcher - that works too)
$openbusinesserpPath = "$env:USERPROFILE\anaconda3\Scripts\openbusinesserp.exe"
# Working directory the server starts in (used for log files)
$workDir = "$env:USERPROFILE"
# Bind host: 127.0.0.1 = localhost only / 0.0.0.0 = LAN-accessible (set firewall!)
$bindHost = "127.0.0.1"
$port = 8000
# === END EDITS ===

if (-not (Test-Path $openbusinesserpPath)) {
    Write-Host "ERROR: openbusinesserp.exe not found at $openbusinesserpPath" -ForegroundColor Red
    Write-Host "Edit the path at the top of this script."
    exit 1
}

$taskName = "OpenBusinessERP"
$action = New-ScheduledTaskAction `
    -Execute $openbusinesserpPath `
    -Argument "serve --host $bindHost --port $port" `
    -WorkingDirectory $workDir

# Trigger: at user logon (per-user). For system-wide use AtStartup with -User SYSTEM.
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME

# Restart on failure, run hidden, no time limit.
$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -RestartCount 5 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -Hidden

$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

# Replace existing if it's already there.
if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
}

Register-ScheduledTask `
    -TaskName $taskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Principal $principal `
    -Description "OpenBusinessERP backend on http://${bindHost}:${port}"

Start-ScheduledTask -TaskName $taskName

Write-Host ""
Write-Host "Installed scheduled task '$taskName'." -ForegroundColor Green
Write-Host "Server will be reachable at: http://${bindHost}:${port}"
Write-Host ""
Write-Host "Manage:"
Write-Host "  schtasks /Query /TN $taskName"
Write-Host "  schtasks /End   /TN $taskName"
Write-Host "  schtasks /Delete /TN $taskName /F"
