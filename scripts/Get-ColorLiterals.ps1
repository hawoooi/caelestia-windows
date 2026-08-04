function Get-ColorLiterals {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$Path)

    $text = [System.IO.File]::ReadAllText($Path)
    $counts = @{}

    $hexPattern = '#[0-9a-fA-F]{6}\b'
    foreach ($m in [regex]::Matches($text, $hexPattern)) {
        $key = $m.Value.ToLowerInvariant()
        if ($counts.ContainsKey($key)) { $counts[$key]++ } else { $counts[$key] = 1 }
    }

    $rgbaPattern = 'rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*(?:,\s*[\d.]+\s*)?\)'
    foreach ($m in [regex]::Matches($text, $rgbaPattern)) {
        $key = ($m.Value -replace '\s+', '').ToLowerInvariant()
        if ($counts.ContainsKey($key)) { $counts[$key]++ } else { $counts[$key] = 1 }
    }

    $counts.GetEnumerator() |
        ForEach-Object { [PSCustomObject]@{ Literal = $_.Key; Count = $_.Value } } |
        Sort-Object -Property Count -Descending
}
