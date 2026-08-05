$script:Root = Split-Path $PSScriptRoot -Parent

function Set-ManagedJunction {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$LinkPath,
        [Parameter(Mandatory)][string]$TargetPath
    )

    if (-not (Test-Path $TargetPath)) { throw "Junction target does not exist: $TargetPath" }

    if (Test-Path $LinkPath) {
        $item = Get-Item $LinkPath -Force
        if ($item.LinkType -ne 'Junction') {
            throw "$LinkPath exists and is NOT a junction. Refusing to replace a real directory."
        }
        if ($item.Target -contains $TargetPath) { return $true }
        Remove-Item $LinkPath -Force
    }

    New-Item -ItemType Junction -Path $LinkPath -Target $TargetPath | Out-Null
    $after = Get-Item $LinkPath -Force
    return ($after.LinkType -eq 'Junction' -and $after.Target -contains $TargetPath)
}

function Set-PatchedBlock {
    <#
      Insert or replace a marker-delimited block inside a file the USER owns.
      Idempotent: identical Content produces a byte-identical file.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][string]$Marker,
        [Parameter(Mandatory)][string]$Content,
        [Parameter(Mandatory)][string]$CommentPrefix
    )

    $open  = "$CommentPrefix >>> $Marker >>>"
    $close = "$CommentPrefix <<< $Marker <<<"
    $block = "$open`n$Content`n$close"

    $text = ''
    if (Test-Path $Path) { $text = [System.IO.File]::ReadAllText($Path) }

    $pattern = [regex]::Escape($open) + '.*?' + [regex]::Escape($close)
    if ([regex]::IsMatch($text, $pattern, 'Singleline')) {
        $new = [regex]::Replace($text, $pattern, { param($m) $block }, 'Singleline')
    } else {
        # NOTE: deliberately no extra blank-line separator here (the brief's
        # original draft inserted one via `$sep + "`n" + $block`). That extra
        # "`n" is indistinguishable, byte-wise, from the file's own trailing
        # newline once written, so Remove-PatchedBlock's matching "\n?\n"
        # prefix ate the ORIGINAL trailing newline instead of the inserted
        # one -- a real round-trip data-loss bug, not a vacuous-test issue.
        # Appending the block directly after $text (separated only by $sep,
        # which is only added when $text doesn't already end in a newline)
        # keeps insertion and removal symmetric: Remove-PatchedBlock only
        # ever has to strip exactly what this branch added.
        $sep = if ($text.Length -eq 0 -or $text.EndsWith("`n")) { '' } else { "`n" }
        $new = $text + $sep + $block + "`n"
    }

    [System.IO.File]::WriteAllText($Path, $new, (New-Object System.Text.UTF8Encoding($false)))
}

function Remove-PatchedBlock {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][string]$Marker,
        [Parameter(Mandatory)][string]$CommentPrefix
    )

    if (-not (Test-Path $Path)) { return }

    $open  = "$CommentPrefix >>> $Marker >>>"
    $close = "$CommentPrefix <<< $Marker <<<"
    $text  = [System.IO.File]::ReadAllText($Path)

    # Mirrors Set-PatchedBlock's insertion exactly: the block plus the single
    # trailing newline it always appends after $close. No leading "\n?" here
    # -- consuming an extra newline before $open would eat the original
    # file's own trailing newline (see the note in Set-PatchedBlock).
    $pattern = [regex]::Escape($open) + '.*?' + [regex]::Escape($close) + "\n?"
    $new = [regex]::Replace($text, $pattern, '', 'Singleline')

    [System.IO.File]::WriteAllText($Path, $new, (New-Object System.Text.UTF8Encoding($false)))
}
