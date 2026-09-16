[CmdletBinding()]
param(
    [string]$WatchFolder,
    [string]$Endpoint = "https://thbptghdspfweogjufun.supabase.co/functions/v1/munis-import",
    [string]$SyncSecret = $env:JAN_CPT_SYNC_SECRET
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($WatchFolder)) {
    $companyDrive = $env:OneDriveCommercial
    if ([string]::IsNullOrWhiteSpace($companyDrive)) {
        $companyDrive = Join-Path $env:USERPROFILE "OneDrive - JMAA"
    }
    $WatchFolder = Join-Path $companyDrive "MUNIS Reports"
}

if ([string]::IsNullOrWhiteSpace($SyncSecret)) {
    throw "JAN_CPT_SYNC_SECRET is not set. Deploy the preview endpoint, create its secret, then store the same value as a Windows user environment variable."
}

$inbox = Join-Path $WatchFolder "Inbox"
$previewFolder = Join-Path $WatchFolder "Previews"
$processedFolder = Join-Path $WatchFolder "Processed"
foreach ($folder in @($inbox, $previewFolder, $processedFolder)) {
    New-Item -ItemType Directory -Path $folder -Force | Out-Null
}

$reports = Get-ChildItem -LiteralPath $inbox -File -Filter "*.csv" | Sort-Object LastWriteTimeUtc
if (-not $reports) {
    Write-Output "No MUNIS CSV reports are waiting in $inbox"
    exit 0
}

foreach ($report in $reports) {
    try {
        $payload = @{
            fileName = $report.Name
            source = "SharePoint / OneDrive"
            csvText = [System.IO.File]::ReadAllText($report.FullName)
        } | ConvertTo-Json -Depth 5

        $result = Invoke-RestMethod -Method Post -Uri $Endpoint -Headers @{
            "x-jan-cpt-sync-secret" = $SyncSecret
        } -ContentType "application/json" -Body $payload

        $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
        $previewPath = Join-Path $previewFolder "$stamp-$($report.BaseName)-preview.json"
        $result | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $previewPath -Encoding utf8

        $destination = Join-Path $processedFolder $report.Name
        if (Test-Path -LiteralPath $destination) {
            $destination = Join-Path $processedFolder "$stamp-$($report.Name)"
        }
        Move-Item -LiteralPath $report.FullName -Destination $destination
        Write-Output "Preview created for $($report.Name): $previewPath"
    }
    catch {
        Write-Error "Could not preview $($report.Name): $($_.Exception.Message)"
    }
}
