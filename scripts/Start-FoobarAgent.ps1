# Starts (or restarts) the foobar2000 retheming agent in its own WezTerm window.
#
# Why this is a script and not a one-liner: the first deployment of this agent
# lost its ENTIRE transcript. It inherited a CLAUDE_CODE_CHILD_SESSION marker,
# which silently disables transcript persistence, so after ~2 hours of work
# there was nothing to resume -- only files on disk. The environment variable
# below is the whole reason this file exists; do not drop it.
#
#     .\scripts\Start-FoobarAgent.ps1
#     .\scripts\Start-FoobarAgent.ps1 -Resume        # pick up a saved session
[CmdletBinding()]
param(
    [switch]$Resume,
    [string]$Briefing = 'docs/foobar2000-briefing.md',
    [string]$WorkingDir = 'C:\Users\PC\Documents\git\setup'
)

$ErrorActionPreference = 'Stop'

$wezterm = 'C:\Program Files\WezTerm\wezterm.exe'
if (-not (Test-Path $wezterm)) { throw "WezTerm not found at $wezterm" }
$briefingPath = Join-Path $WorkingDir $Briefing
if (-not (Test-Path $briefingPath)) { throw "Briefing not found at $briefingPath" }

# The agent's opening instruction. It points at the briefing rather than
# restating it, so there is exactly one copy of the task and the "STATE AT
# RESTART" section cannot drift out of sync with a prompt buried in a script.
$prompt = @(
    "Read docs/foobar2000-briefing.md in full before doing anything, including its"
    "'STATE AT RESTART' section at the bottom -- that section is the only surviving"
    "record of about two hours of prior work on this task, because the previous"
    "agent's transcript was never saved. Do not redo what it says is already done."
    "Confirm the current state yourself, then continue from what is genuinely"
    "unfinished. The user's live foobar2000 is running; all work belongs in the"
    "duplicate install at C:\Users\PC\Music\foobar2000-caelestia."
) -join ' '

$inner = @(
    '$env:CLAUDE_CODE_FORCE_SESSION_PERSISTENCE = ''1'''
    "Set-Location '$WorkingDir'"
    "Write-Host 'foobar2000 agent -- transcript persistence forced ON' -ForegroundColor Cyan"
    $(if ($Resume) { 'claude --resume --dangerously-skip-permissions' }
      else { "claude --dangerously-skip-permissions '$($prompt -replace "'", "''")'" })
) -join '; '

Start-Process -FilePath $wezterm -ArgumentList @(
    'start', '--always-new-process', '--',
    'powershell.exe', '-NoLogo', '-NoExit', '-ExecutionPolicy', 'Bypass', '-Command', $inner
)

Write-Output "Launched the foobar2000 agent in a new WezTerm window."
Write-Output "  cwd        : $WorkingDir"
Write-Output "  briefing   : $Briefing"
Write-Output "  persistence: CLAUDE_CODE_FORCE_SESSION_PERSISTENCE=1"
Write-Output "  permissions: --dangerously-skip-permissions (matches the previous deployment)"
