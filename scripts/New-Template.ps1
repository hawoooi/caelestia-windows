function New-Template {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$SourcePath,
        [Parameter(Mandatory)][string]$MappingPath,
        [Parameter(Mandatory)][string]$OutputPath
    )

    $text = [System.IO.File]::ReadAllText($SourcePath)
    $map  = Get-Content $MappingPath -Raw | ConvertFrom-Json

    foreach ($prop in $map.PSObject.Properties) {
        $literal    = $prop.Name
        $expression = $prop.Value.expression

        if ($literal.StartsWith('#')) {
            # Case-insensitive: the stylesheet mixes #cba6f7 and #CBA6F7.
            $pattern = [regex]::Escape($literal)
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
