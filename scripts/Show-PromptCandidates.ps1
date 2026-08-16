# Prints every starship prompt candidate into YOUR terminal, with real colours
# and the real font, so they can be compared before one is chosen.
#
# Why a script you run rather than output from the agent: prompts are ANSI
# truecolour escapes. Rendered into a chat transcript they arrive as either
# plain text (colour lost, which is most of the design) or as an image (not
# the terminal, and not the terminal's font). Printed here, by your own shell,
# they are exactly what you would get.
#
# Nothing is applied. Each candidate is a standalone config rendered through
# STARSHIP_CONFIG; ~/.config/starship.toml is untouched.
#
# Usage, from the repo root:
#     .\scripts\Show-PromptCandidates.ps1
#     .\scripts\Show-PromptCandidates.ps1 -Apply pill     # wire one in
param(
    [string]$Dir = (Join-Path $PSScriptRoot '..\state\prompt-candidates'),
    [string]$Apply
)

$ErrorActionPreference = 'Stop'
$ESC = [char]27          # `e is PowerShell 6+; this machine has 5.1 only.
$reset = "$ESC[0m"
$dim = "$ESC[38;2;137;147;147m"
$head = "$ESC[1;38;2;128;212;217m"

if (-not (Test-Path $Dir)) {
    Write-Host "No candidates at $Dir -- run the generator first." -ForegroundColor Yellow
    exit 1
}

$files = Get-ChildItem $Dir -Filter '*.toml' | Sort-Object Name
if (-not $files) { Write-Host "No .toml candidates in $Dir" -ForegroundColor Yellow; exit 1 }

if ($Apply) {
    $src = Join-Path $Dir "$Apply.toml"
    if (-not (Test-Path $src)) {
        Write-Host "No candidate named '$Apply'. Available: $(($files | ForEach-Object { $_.BaseName }) -join ', ')" -ForegroundColor Yellow
        exit 1
    }
    Write-Host ""
    Write-Host "  '$Apply' is a PREVIEW config with the current palette baked in as literal" -ForegroundColor Yellow
    Write-Host "  hex. Applying it here would make the prompt stop following the wallpaper." -ForegroundColor Yellow
    Write-Host "  Ask for it to be ported into matugen/templates/starship.toml instead --" -ForegroundColor Yellow
    Write-Host "  that is the only version that re-themes." -ForegroundColor Yellow
    Write-Host ""
    exit 0
}

# Rendered from a real git repo, so the branch and status segments have
# something to show. An empty directory hides half of every candidate and
# flatters them all equally.
$repo = Resolve-Path (Join-Path $PSScriptRoot '..')
Push-Location $repo
try {
    Write-Host ""
    Write-Host "${head}starship prompt candidates$reset  ${dim}rendered from $repo$reset"
    Write-Host "${dim}nothing is applied; pick one by name$reset"
    Write-Host ""

    $i = 1
    foreach ($f in $files) {
        $env:STARSHIP_CONFIG = $f.FullName
        # stderr carries starship's own parse warnings; surface them rather
        # than printing a silently-degraded prompt as if it were the design.
        $warnings = @()
        $out = & starship prompt --status=0 2>&1 | ForEach-Object {
            if ($_ -is [System.Management.Automation.ErrorRecord]) { $warnings += $_.ToString(); '' } else { $_ }
        }
        Write-Host ("  ${head}{0}. {1}$reset" -f $i, $f.BaseName)
        Write-Host ""
        Write-Host ("    " + ($out -join "`n    "))
        Write-Host ""
        if ($warnings) {
            foreach ($w in $warnings) { Write-Host "    ${dim}warning: $w$reset" }
            Write-Host ""
        }
        $i++
    }

    Write-Host "${dim}  The trailing ? on the git segment is real status (untracked files).$reset"
    Write-Host "${dim}  None of these use powerline separators: wezterm's cell_width = 0.9$reset"
    Write-Host "${dim}  clips those into broken chevrons.$reset"
    Write-Host ""
}
finally {
    Pop-Location
    Remove-Item Env:\STARSHIP_CONFIG -ErrorAction SilentlyContinue
}
