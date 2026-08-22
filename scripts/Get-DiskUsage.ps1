<#
.SYNOPSIS
    Break down where disk space has actually gone.

.DESCRIPTION
    Walks a volume once and attributes every byte it can read to a folder
    bucket, then reports the biggest buckets, the biggest individual files,
    and the well-known space sinks that a folder walk CANNOT see (pagefile,
    hibernation, shadow copies, the component store).

    THE NUMBER THAT MATTERS MOST IS "UNACCOUNTED". A plain folder walk run
    without admin silently skips everything it cannot open, so it always
    under-reports -- and a tool that under-reports without saying so sends you
    hunting in the wrong place. This script tracks what it was denied and
    prints used-minus-measured explicitly, so a large gap is visible as a gap
    rather than quietly missing from the totals.

.PARAMETER Path
    Where to start. Defaults to the system drive root.

.PARAMETER Depth
    How many folder levels below -Path to group by. Depth 1 gives you
    "C:\Windows, C:\Users, C:\Program Files"; depth 2 breaks each of those
    open. Default 2, which is usually the level where the culprit is obvious.

.PARAMETER Top
    How many rows to show in each table. Default 25.

.PARAMETER MinFileSizeMB
    Only remember individual files at least this big, for the large-file
    table. Keeping every file would cost gigabytes of RAM on a full disk.
    Default 200.

.PARAMETER CsvPath
    Optional. Write the full bucket list (not just the top N) to CSV, so a
    scan of a big volume can be sorted and re-sorted without re-walking it.

.EXAMPLE
    .\Get-DiskUsage.ps1
    Scan the system drive, group two levels deep.

.EXAMPLE
    .\Get-DiskUsage.ps1 -Path C:\Users\PC -Depth 2 -Top 40
    Find out what inside a home directory is heavy.

.NOTES
    Runs fine without elevation and will tell you what it could not read.
    Running as admin measures more and shrinks the unaccounted figure --
    shadow-copy storage in particular can only be queried elevated.

    PowerShell 5.1 compatible: no ternary, no ??, no && (see CLAUDE.md).
#>
[CmdletBinding()]
param(
    [string]$Path = "$env:SystemDrive\",
    [int]$Depth = 2,
    [int]$Top = 25,
    [int]$MinFileSizeMB = 200,
    [string]$CsvPath,
    # Allow -CsvPath to replace a file that already exists. Off by default:
    # see the guard at the write itself.
    [switch]$ForceCsv
)

$ErrorActionPreference = 'Stop'

function Format-Size {
    param([double]$Bytes)
    if ($Bytes -ge 1TB) { return ('{0:N2} TB' -f ($Bytes / 1TB)) }
    if ($Bytes -ge 1GB) { return ('{0:N2} GB' -f ($Bytes / 1GB)) }
    if ($Bytes -ge 1MB) { return ('{0:N1} MB' -f ($Bytes / 1MB)) }
    if ($Bytes -ge 1KB) { return ('{0:N0} KB' -f ($Bytes / 1KB)) }
    return ('{0:N0} B' -f $Bytes)
}

function Write-Rule {
    param([string]$Title)
    Write-Host ''
    Write-Host ('=' * 78) -ForegroundColor DarkCyan
    Write-Host "  $Title" -ForegroundColor Cyan
    Write-Host ('=' * 78) -ForegroundColor DarkCyan
}

if (-not (Test-Path -LiteralPath $Path)) { throw "Path not found: $Path" }
$root = [System.IO.Path]::GetFullPath($Path)

# ---------------------------------------------------------------------------
# Volume summary. Taken from the filesystem itself rather than derived from
# the walk, so it is a genuine independent figure to compare the walk against.
# ---------------------------------------------------------------------------
$driveLetter = [System.IO.Path]::GetPathRoot($root).TrimEnd('\')
$vol = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='$driveLetter'" -ErrorAction SilentlyContinue

Write-Rule "VOLUME $driveLetter"
if ($vol) {
    $used = $vol.Size - $vol.FreeSpace
    $pct  = 0
    if ($vol.Size -gt 0) { $pct = ($used / $vol.Size) * 100 }
    Write-Host ("  Capacity : {0}" -f (Format-Size $vol.Size))
    Write-Host ("  Used     : {0}  ({1:N1}%)" -f (Format-Size $used), $pct) -ForegroundColor Yellow
    Write-Host ("  Free     : {0}" -f (Format-Size $vol.FreeSpace)) -ForegroundColor Green
} else {
    Write-Host "  (could not read volume info for $driveLetter)" -ForegroundColor DarkYellow
}

# ---------------------------------------------------------------------------
# The walk.
#
# Two decisions worth knowing about:
#
# 1. DirectoryInfo.EnumerateFiles() rather than Directory.EnumerateFiles().
#    The DirectoryInfo form hands back FileInfo objects whose .Length is
#    already populated from the directory scan Windows just did. The string
#    form would make us stat every file again -- one extra syscall per file,
#    which on a drive with a million files is the difference between a
#    coffee and an afternoon.
#
# 2. Reparse points are NOT followed. Junctions and symlinks would otherwise
#    be counted twice (once at the link, once at the target) and a link that
#    points at one of its own ancestors would loop forever. This machine has
#    real examples -- ~/.glzr/zebar/caelestia is a junction into a git repo,
#    and C:\Users\All Users points at ProgramData. Skipped links are counted
#    so they show up in the summary instead of vanishing silently.
# ---------------------------------------------------------------------------
Write-Rule "SCANNING $root"
Write-Host "  Grouping $Depth level(s) deep. Large volumes take a few minutes." -ForegroundColor DarkGray
Write-Host ''

$buckets   = @{}   # bucket path -> [long] bytes
$bigFiles  = New-Object System.Collections.ArrayList
$minBytes  = [long]$MinFileSizeMB * 1MB

$totalBytes   = [long]0
$fileCount    = [long]0
$dirCount     = [long]0
$deniedCount  = 0
$deniedSample = New-Object System.Collections.ArrayList
$linkCount    = 0
$linkSample   = New-Object System.Collections.ArrayList

$sw = [System.Diagnostics.Stopwatch]::StartNew()

# Stack entries: the directory, its depth below root, and the bucket every
# byte underneath it belongs to. Carrying the bucket down the walk means we
# never have to re-derive it per file by splitting strings.
$stack = New-Object System.Collections.Stack
try {
    $rootInfo = New-Object System.IO.DirectoryInfo $root
} catch {
    throw "Cannot open $root : $_"
}
$stack.Push([PSCustomObject]@{ Dir = $rootInfo; Level = 0; Bucket = '(files directly in root)' })

while ($stack.Count -gt 0) {
    $node = $stack.Pop()
    $dir  = $node.Dir
    $dirCount++

    if ($sw.ElapsedMilliseconds -gt 1000) {
        Write-Progress -Activity "Scanning $root" `
                       -Status ("{0} files / {1} folders / {2} so far" -f $fileCount, $dirCount, (Format-Size $totalBytes)) `
                       -CurrentOperation $dir.FullName
        $sw.Restart()
    }

    # Files in this directory.
    try {
        foreach ($f in $dir.EnumerateFiles()) {
            # A reparse point on a FILE (e.g. OneDrive placeholders, dedup
            # stubs) reports a logical length that is not really on the disk.
            # Counting it would inflate the report, so skip it the same way
            # directory links are skipped.
            if (($f.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { continue }

            $len = $f.Length
            $totalBytes += $len
            $fileCount++

            $b = $node.Bucket
            if ($buckets.ContainsKey($b)) { $buckets[$b] += $len } else { $buckets[$b] = $len }

            if ($len -ge $minBytes) {
                [void]$bigFiles.Add([PSCustomObject]@{ Size = $len; FullName = $f.FullName })
            }
        }
    } catch [System.UnauthorizedAccessException] {
        $deniedCount++
        if ($deniedSample.Count -lt 15) { [void]$deniedSample.Add($dir.FullName) }
    } catch {
        # Long paths, vanished-mid-scan files, hardware errors. Not fatal --
        # the unaccounted figure at the end is what surfaces the shortfall.
    }

    # Subdirectories.
    try {
        foreach ($d in $dir.EnumerateDirectories()) {
            if (($d.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
                $linkCount++
                if ($linkSample.Count -lt 10) { [void]$linkSample.Add($d.FullName) }
                continue
            }

            $childLevel = $node.Level + 1
            if ($childLevel -le $Depth) {
                $childBucket = $d.FullName
            } else {
                $childBucket = $node.Bucket
            }

            $stack.Push([PSCustomObject]@{ Dir = $d; Level = $childLevel; Bucket = $childBucket })
        }
    } catch [System.UnauthorizedAccessException] {
        $deniedCount++
        if ($deniedSample.Count -lt 15) { [void]$deniedSample.Add($dir.FullName) }
    } catch {
    }
}

Write-Progress -Activity "Scanning $root" -Completed

# ---------------------------------------------------------------------------
# Results
# ---------------------------------------------------------------------------
Write-Rule "BIGGEST FOLDERS (depth $Depth)"

$ranked = $buckets.GetEnumerator() | Sort-Object -Property Value -Descending

$rows = @()
$rank = 0
foreach ($e in $ranked) {
    $rank++
    if ($rank -gt $Top) { break }
    $share = 0
    if ($totalBytes -gt 0) { $share = ($e.Value / $totalBytes) * 100 }
    $rows += [PSCustomObject]@{
        Size    = (Format-Size $e.Value)
        'Share' = ('{0,5:N1}%' -f $share)
        Folder  = $e.Key
    }
}
$rows | Format-Table -AutoSize

if ($CsvPath) {
    # This is the ONLY thing this script writes anywhere. Everything else is
    # read-only by construction. Export-Csv overwrites without asking, so an
    # existing file is refused rather than clobbered -- a reporting tool has
    # no business destroying data, least of all silently, and least of all
    # while you are running it because the disk is already in trouble.
    if ((Test-Path -LiteralPath $CsvPath) -and (-not $ForceCsv)) {
        Write-Warning "  $CsvPath already exists -- NOT overwritten. Pass -ForceCsv to replace it, or choose another path."
    } else {
        $all = foreach ($e in $ranked) {
            [PSCustomObject]@{ Bytes = $e.Value; GB = [math]::Round($e.Value / 1GB, 3); Folder = $e.Key }
        }
        $all | Export-Csv -LiteralPath $CsvPath -NoTypeInformation -Encoding UTF8
        Write-Host "  Full bucket list written to $CsvPath" -ForegroundColor DarkGray
    }
}

Write-Rule "BIGGEST FILES (>= $MinFileSizeMB MB)"
if ($bigFiles.Count -eq 0) {
    Write-Host "  No single file that large." -ForegroundColor DarkGray
} else {
    $bigFiles |
        Sort-Object -Property Size -Descending |
        Select-Object -First $Top |
        ForEach-Object { [PSCustomObject]@{ Size = (Format-Size $_.Size); File = $_.FullName } } |
        Format-Table -AutoSize
}

# ---------------------------------------------------------------------------
# The things a folder walk cannot see, or reports misleadingly.
# ---------------------------------------------------------------------------
Write-Rule "KNOWN SPACE SINKS"

$sinks = @(
    @{ Name = 'Hibernation file';        Path = "$env:SystemDrive\hiberfil.sys";  Hint = 'powercfg /h off  (frees ~40% of RAM size; disables Fast Startup)' },
    @{ Name = 'Page file';               Path = "$env:SystemDrive\pagefile.sys";  Hint = 'System > About > Advanced system settings > Performance' },
    @{ Name = 'Swap file';               Path = "$env:SystemDrive\swapfile.sys";  Hint = 'Managed with the page file' },
    @{ Name = 'Windows Update cache';    Path = "$env:SystemRoot\SoftwareDistribution\Download"; Hint = 'Safe to clear: Disk Cleanup, or stop wuauserv and delete' },
    @{ Name = 'Component store (WinSxS)'; Path = "$env:SystemRoot\WinSxS";        Hint = 'DISM /Online /Cleanup-Image /AnalyzeComponentStore  (never delete by hand)' },
    @{ Name = 'Previous Windows install'; Path = "$env:SystemDrive\Windows.old";  Hint = 'Disk Cleanup > Previous Windows installations' },
    @{ Name = 'Delivery Optimization';   Path = "$env:SystemRoot\SoftwareDistribution\DeliveryOptimization"; Hint = 'Safe to clear' },
    @{ Name = 'User temp';               Path = $env:TEMP;                        Hint = 'Safe to clear when nothing is mid-install' },
    @{ Name = 'Windows temp';            Path = "$env:SystemRoot\Temp";           Hint = 'Safe to clear' },
    @{ Name = 'Crash dumps';             Path = "$env:SystemRoot\LiveKernelReports"; Hint = 'Safe to clear' },
    @{ Name = 'Memory dump';             Path = "$env:SystemRoot\MEMORY.DMP";     Hint = 'Safe to delete' }
)

foreach ($s in $sinks) {
    if (-not (Test-Path -LiteralPath $s.Path -ErrorAction SilentlyContinue)) { continue }
    $item = Get-Item -LiteralPath $s.Path -Force -ErrorAction SilentlyContinue
    if (-not $item) { continue }

    if ($item.PSIsContainer) {
        $sum = 0
        try {
            $sum = (Get-ChildItem -LiteralPath $s.Path -Recurse -File -Force -ErrorAction SilentlyContinue |
                    Measure-Object -Property Length -Sum).Sum
        } catch { }
        if (-not $sum) { $sum = 0 }
    } else {
        $sum = $item.Length
    }

    if ($sum -lt 100MB) { continue }
    Write-Host ("  {0,-28} {1,12}" -f $s.Name, (Format-Size $sum)) -ForegroundColor Yellow
    Write-Host ("  {0,-28} {1}" -f '', $s.Hint) -ForegroundColor DarkGray
}

# Recycle Bin: a per-volume hidden folder the walk skips, and routinely
# holds tens of gigabytes that people assume they already deleted.
$binTotal = 0
try {
    $binPath = "$driveLetter\`$Recycle.Bin"
    if (Test-Path -LiteralPath $binPath) {
        $binTotal = (Get-ChildItem -LiteralPath $binPath -Recurse -File -Force -ErrorAction SilentlyContinue |
                     Measure-Object -Property Length -Sum).Sum
    }
} catch { }
if ($binTotal -gt 0) {
    Write-Host ("  {0,-28} {1,12}" -f 'Recycle Bin', (Format-Size $binTotal)) -ForegroundColor Yellow
    Write-Host ("  {0,-28} {1}" -f '', 'Clear-RecycleBin -Force') -ForegroundColor DarkGray
}

# Shadow copies / System Restore. Invisible to any folder walk at any
# privilege level, and one of the most common causes of "my free space
# vanished and I cannot find it". Needs elevation to query.
Write-Host ''
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()
           ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if ($isAdmin) {
    Write-Host "  Shadow copy / System Restore storage:" -ForegroundColor Yellow
    & vssadmin list shadowstorage 2>&1 |
        Where-Object { $_ -match 'Used|Allocated|Maximum|For volume' } |
        ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
} else {
    Write-Host "  Shadow copy / System Restore storage: NOT MEASURED (needs admin)" -ForegroundColor DarkYellow
    Write-Host "    Re-run elevated, or: vssadmin list shadowstorage" -ForegroundColor DarkGray
    Write-Host "    This is invisible to any folder scan and is a common cause of missing space." -ForegroundColor DarkGray
}

# ---------------------------------------------------------------------------
# Reconciliation. The honest part.
# ---------------------------------------------------------------------------
Write-Rule "RECONCILIATION"
Write-Host ("  Files measured    : {0:N0}" -f $fileCount)
Write-Host ("  Folders visited   : {0:N0}" -f $dirCount)
Write-Host ("  Bytes measured    : {0}" -f (Format-Size $totalBytes))

if ($vol -and $root -eq [System.IO.Path]::GetPathRoot($root)) {
    $usedBytes   = $vol.Size - $vol.FreeSpace
    $unaccounted = $usedBytes - $totalBytes
    Write-Host ("  Volume reports used: {0}" -f (Format-Size $usedBytes))
    $colour = 'Green'
    if ($unaccounted -gt 20GB) { $colour = 'Red' } elseif ($unaccounted -gt 5GB) { $colour = 'Yellow' }
    Write-Host ("  UNACCOUNTED       : {0}" -f (Format-Size $unaccounted)) -ForegroundColor $colour
    if ($unaccounted -gt 5GB) {
        Write-Host ''
        Write-Host "  That gap is real space this scan could not attribute. In order of likelihood:" -ForegroundColor DarkGray
        Write-Host "    - Shadow copies / System Restore (run elevated to measure)" -ForegroundColor DarkGray
        Write-Host "    - Folders access was denied to (count below) -- re-run elevated" -ForegroundColor DarkGray
        Write-Host "    - Other users' profiles under C:\Users" -ForegroundColor DarkGray
        Write-Host "    - NTFS metadata, and files inside the skipped reparse points" -ForegroundColor DarkGray
    }
}

if ($deniedCount -gt 0) {
    Write-Host ''
    Write-Host ("  Access denied in {0:N0} folder(s)." -f $deniedCount) -ForegroundColor DarkYellow
    if (-not $isAdmin) { Write-Host "  Re-run elevated to measure these." -ForegroundColor DarkGray }
    foreach ($d in $deniedSample) { Write-Host "    $d" -ForegroundColor DarkGray }
}

if ($linkCount -gt 0) {
    Write-Host ''
    Write-Host ("  Skipped {0:N0} junction/symlink(s) so nothing is double-counted:" -f $linkCount) -ForegroundColor DarkYellow
    foreach ($l in $linkSample) { Write-Host "    $l" -ForegroundColor DarkGray }
}

Write-Host ''
