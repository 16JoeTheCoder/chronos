<#
.SYNOPSIS
  Optional: make Chronos appear sooner after you sign in to Windows (spec §8.4).
  UNVERIFIED-ON-WINDOWS: written and reviewed on Linux; test it on your PC.

.DESCRIPTION
  Run in Windows PowerShell (Start menu -> "Windows PowerShell"):
    -Mode Registry  Sets HKCU\...\Explorer\Serialize\StartupDelayInMSec = 0, so
                    Windows stops delaying startup apps (per user, no admin needed).
    -Mode Task      Registers a per-user scheduled task that starts Chronos at logon
                    with --launch. If this fails without elevation, re-run
                    PowerShell as Administrator.
    -Undo           Reverts the chosen mode.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\windows\fast-startup.ps1 -Mode Registry
  powershell -ExecutionPolicy Bypass -File scripts\windows\fast-startup.ps1 -Mode Task -ExePath "C:\Program Files\Chronos\Chronos.exe"
  powershell -ExecutionPolicy Bypass -File scripts\windows\fast-startup.ps1 -Mode Task -Undo
#>
param(
  [Parameter(Mandatory = $true)][ValidateSet('Registry', 'Task')][string]$Mode,
  [switch]$Undo,
  [string]$ExePath = "$env:LOCALAPPDATA\Programs\Chronos\Chronos.exe"
)

$ErrorActionPreference = 'Stop'
$key = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\Serialize'
$taskName = 'Chronos at logon'

if ($Mode -eq 'Registry') {
  if ($Undo) {
    if (Test-Path $key) { Remove-ItemProperty -Path $key -Name 'StartupDelayInMSec' -ErrorAction SilentlyContinue }
    Write-Host 'ok  Startup delay restored to the Windows default.'
  } else {
    if (-not (Test-Path $key)) { New-Item -Path $key -Force | Out-Null }
    New-ItemProperty -Path $key -Name 'StartupDelayInMSec' -Value 0 -PropertyType DWord -Force | Out-Null
    Write-Host 'ok  StartupDelayInMSec = 0. Sign out and in again to feel it.'
  }
  exit 0
}

if ($Undo) {
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
  Write-Host "ok  Removed the scheduled task '$taskName'."
  exit 0
}

if (-not (Test-Path $ExePath)) {
  Write-Host "x   Chronos.exe not found at $ExePath. Pass -ExePath with the installed location."
  exit 1
}
try {
  $action = New-ScheduledTaskAction -Execute $ExePath -Argument '--launch'
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Seconds 0)
  Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
  Write-Host "ok  Registered '$taskName'. Turn off Launch at login in Chronos settings so it does not start twice."
} catch {
  Write-Host "!   Could not register the task: $($_.Exception.Message)"
  Write-Host '    Re-run this in PowerShell as Administrator (right-click Windows PowerShell -> Run as administrator).'
  exit 1
}
