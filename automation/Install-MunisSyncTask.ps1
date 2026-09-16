[CmdletBinding()]
param(
    [string]$WatchFolder,
    [string]$TaskName = "JAN CPT MUNIS Preview Sync"
)

$ErrorActionPreference = "Stop"
$sender = Join-Path $PSScriptRoot "Send-MunisReport.ps1"
if (-not (Test-Path -LiteralPath $sender)) {
    throw "Send-MunisReport.ps1 was not found beside this installer."
}
if ([string]::IsNullOrWhiteSpace($env:JAN_CPT_SYNC_SECRET)) {
    throw "Set the JAN_CPT_SYNC_SECRET Windows user environment variable before installing the task."
}
if ([string]::IsNullOrWhiteSpace($WatchFolder)) {
    $companyDrive = $env:OneDriveCommercial
    if ([string]::IsNullOrWhiteSpace($companyDrive)) {
        $companyDrive = Join-Path $env:USERPROFILE "OneDrive - JMAA"
    }
    $WatchFolder = Join-Path $companyDrive "MUNIS Reports"
}

foreach ($name in @("Inbox", "Previews", "Processed")) {
    New-Item -ItemType Directory -Path (Join-Path $WatchFolder $name) -Force | Out-Null
}

$pwsh = (Get-Command pwsh.exe -ErrorAction Stop).Source
$arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$sender`" -WatchFolder `"$WatchFolder`""
$action = New-ScheduledTaskAction -Execute $pwsh -Argument $arguments
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(5) `
    -RepetitionInterval (New-TimeSpan -Hours 1) `
    -RepetitionDuration (New-TimeSpan -Days 3650)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 10)
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings `
    -Description "Stages a safe JAN CPT preview when a MUNIS CSV appears in the synced SharePoint folder." `
    -Force | Out-Null

Write-Output "Installed '$TaskName'. It will check $WatchFolder\Inbox every hour."
