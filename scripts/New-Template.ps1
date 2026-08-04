function New-Template {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$SourcePath,
        [Parameter(Mandatory)][string]$MappingPath,
        [Parameter(Mandatory)][string]$OutputPath
    )

    $text = [System.IO.File]::ReadAllText($SourcePath)
    $map  = Get-Content $MappingPath -Raw | ConvertFrom-Json

    # Ordering constraint: substitutions apply in sequence to the evolving
    # $text, so a mapping expression must never contain the literal text of
    # another mapping's key -- an earlier inserted expression could then be
    # re-matched (or fail to be re-matched, depending on property order) by a
    # later entry, corrupting the result in an order-dependent way. Real
    # matugen expressions ("{{colors.X.default.hex}}") never contain "#hex"
    # text, so this is not a live risk today, but it is a real structural
    # constraint on any mapping.json this function is given. Test-Roundtrip
    # catches a violation if one is ever introduced (see
    # tests/Roundtrip.Tests.ps1, "ordering dependence" test).
    foreach ($prop in $map.PSObject.Properties) {
        $literal    = $prop.Name
        $expression = $prop.Value.expression

        if ($literal.StartsWith('#')) {
            # Case-insensitive: the stylesheet mixes #cba6f7 and #CBA6F7.
            # The lookahead stops a 6-digit literal from matching INSIDE a longer
            # hex run. Without it, #ABCDEF12 with a mapped #abcdef becomes
            # "{{expr}}12" -- the alpha suffix is orphaned onto the expression,
            # and because Test-Roundtrip's normalization shared the same flaw,
            # both sides corrupted symmetrically and the gate returned true.
            # Get-ColorLiterals guards the same case with \b.
            # Verified: '#abcdef(?![0-9a-fA-F])' (IgnoreCase) has zero matches
            # against '#ABCDEF12', and one match against '#ABCDEF;' / '#abcdef)'.
            $pattern = [regex]::Escape($literal) + '(?![0-9a-fA-F])'
            $text = [regex]::Replace($text, $pattern, $expression, 'IgnoreCase')
        }
        else {
            # rgba(): the mapping key is whitespace-stripped, the source may not be.
            $loose = [regex]::Escape($literal) -replace ',', '\s*,\s*' -replace '\\\(', '\(\s*' -replace '\\\)', '\s*\)'
            $text = [regex]::Replace($text, $loose, $expression, 'IgnoreCase')
        }
    }

    [System.IO.File]::WriteAllText($OutputPath, $text, (New-Object System.Text.UTF8Encoding($false)))
}
