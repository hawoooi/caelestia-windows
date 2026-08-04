function Test-Roundtrip {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$SourcePath,
        [Parameter(Mandatory)][string]$TemplatePath,
        [Parameter(Mandatory)][string]$MappingPath
    )

    $source   = [System.IO.File]::ReadAllText($SourcePath)
    $template = [System.IO.File]::ReadAllText($TemplatePath)
    $map      = Get-Content $MappingPath -Raw | ConvertFrom-Json

    # Reverse the mapping: every expression becomes its original literal.
    foreach ($prop in $map.PSObject.Properties) {
        $template = $template.Replace($prop.Value.expression, $prop.Name)
    }

    # Normalize the source the same way the mapping keys were normalized,
    # so case and whitespace differences do not register as damage.
    foreach ($prop in $map.PSObject.Properties) {
        $literal = $prop.Name
        if ($literal.StartsWith('#')) {
            # Same lookahead as New-Template, for the same reason. These two
            # patterns MUST stay identical: if they diverge, or if both share a
            # flaw, corruption cancels out symmetrically and the gate passes
            # code it should reject.
            $source = [regex]::Replace($source, ([regex]::Escape($literal) + '(?![0-9a-fA-F])'), $literal, 'IgnoreCase')
        }
        else {
            $loose = [regex]::Escape($literal) -replace ',', '\s*,\s*' -replace '\\\(', '\(\s*' -replace '\\\)', '\s*\)'
            $source = [regex]::Replace($source, $loose, $literal, 'IgnoreCase')
        }
    }

    if ($source -ceq $template) { return $true }

    # Report the first divergence so failures are diagnosable.
    $min = [Math]::Min($source.Length, $template.Length)
    for ($i = 0; $i -lt $min; $i++) {
        if ($source[$i] -cne $template[$i]) {
            $from = [Math]::Max(0, $i - 40)
            Write-Warning "Diverges at offset ${i}:"
            Write-Warning "  source:   ...$($source.Substring($from, [Math]::Min(80, $source.Length - $from)))"
            Write-Warning "  template: ...$($template.Substring($from, [Math]::Min(80, $template.Length - $from)))"
            break
        }
    }
    if ($source.Length -ne $template.Length) {
        Write-Warning "Length differs: source=$($source.Length) template=$($template.Length)"
    }
    return $false
}
