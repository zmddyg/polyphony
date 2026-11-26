param([string]$InputFile,[string]$OutputFile,[int]$PageLimit,[int]$ExpectedPages,[long]$MaxBytes,[string]$HiddenJson,[switch]$Probe)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
if ($Probe) { Write-Output 'ready'; exit 0 }
$presentation = $null
$application = $null
$mutex = New-Object System.Threading.Mutex($false, 'Local\PolyphonyMaterialPowerPoint')
$locked = $false
try {
    $locked = $mutex.WaitOne(30000)
    if (-not $locked) { throw 'powerpoint-busy' }
    # Never attach to, alter, or quit a PowerPoint instance owned by the user.
    # A prior converter can need a moment to exit after COM Quit/GC.
    for ($attempt=0; $attempt -lt 30; $attempt++) {
        if (-not (Get-Process POWERPNT -ErrorAction SilentlyContinue)) { break }
        Start-Sleep -Milliseconds 100
    }
    if (Get-Process POWERPNT -ErrorAction SilentlyContinue) { throw 'powerpoint-busy' }
    $application = New-Object -ComObject PowerPoint.Application
    $application.AutomationSecurity = 3 # msoAutomationSecurityForceDisable
    $application.DisplayAlerts = 1 # ppAlertsNone
    $presentation = $application.Presentations.Open($InputFile, -1, 0, 0)
    $pageCount = $presentation.Slides.Count
    if ($pageCount -lt 1 -or $pageCount -gt $PageLimit) { throw 'page-limit' }
    if ($ExpectedPages -gt 0 -and $pageCount -ne $ExpectedPages) { throw 'page-count' }
    $hiddenSlides = @()
    for ($index=1; $index -le $pageCount; $index++) {
        if ($presentation.Slides.Item($index).SlideShowTransition.Hidden -eq -1) { $hiddenSlides += $index }
        $presentation.Slides.Item($index).SlideShowTransition.Hidden = 0
    }
    # Include hidden pages in the PDF, then retain their original visibility metadata.
    $range = $presentation.PrintOptions.Ranges.Add(1, $pageCount)
    $presentation.ExportAsFixedFormat($OutputFile, 2, 1, 0, 1, 1, -1, $range, 4)
    [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($range)
    if ((Get-Item -LiteralPath $OutputFile).Length -gt $MaxBytes) { throw 'size-limit' }
    @{pageCount=$pageCount; hidden=@($hiddenSlides)} | ConvertTo-Json -Compress
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    $kind = if ($_.Exception.Message -match 'powerpoint-busy') { 'powerpoint-busy' } elseif ($_.Exception.Message -match 'page-limit') { 'page-limit' } else { 'conversion-failed' }
    @{error=$kind} | ConvertTo-Json -Compress
} finally {
    if ($presentation) { $presentation.Saved = -1; $presentation.Close(); [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($presentation) }
    if ($application) { $application.Quit(); [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($application) }
    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()
    if ($locked) { [void]$mutex.ReleaseMutex() }
    $mutex.Dispose()
}
