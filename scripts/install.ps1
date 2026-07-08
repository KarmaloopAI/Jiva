# Jivam installer for Windows
# Usage (run in PowerShell as a normal user — admin rights are not required):
#   irm https://raw.githubusercontent.com/KarmaloopAI/Jivam/main/scripts/install.ps1 | iex
#
# Requires PowerShell 5.1+ (built into Windows 10/11). If Node.js needs to be
# installed and winget is available, it may show a one-time UAC prompt (its
# Node.js package installs machine-wide); if you can't approve that (no admin
# rights) or winget isn't available, this falls back to a portable, per-user
# Node.js install that needs no elevation at all.

$ErrorActionPreference = 'Stop'

$Purple = [char]27 + '[35m'
$Green  = [char]27 + '[32m'
$Yellow = [char]27 + '[33m'
$Bold   = [char]27 + '[1m'
$Reset  = [char]27 + '[0m'

function Log    { param($msg) Write-Host "$Purple`u{25B8}$Reset $msg" }
function Ok     { param($msg) Write-Host "$Green`u{2713}$Reset $msg" }
function Warn   { param($msg) Write-Host "$Yellow`u{26A0}$Reset  $msg" }
function Header { param($msg) Write-Host "`n$Bold$Purple$msg$Reset`n" }

# ─────────────────────────────────────────────────────────────────────────────
Header "Jivam Installer"
Write-Host "  This will install Jivam and set it up on your Windows PC."
Write-Host ""

# ── 1. Node.js ───────────────────────────────────────────────────────────────
Header "Step 1 of 3 - Node.js"

function Get-NodeMajor {
    try {
        $v = (node --version 2>$null).TrimStart('v')
        return [int]($v.Split('.')[0])
    } catch { return 0 }
}

# jiva-core requires Node >=20 (see its package.json "engines" field) — this
# used to check >=18, which let an already-too-old Node quietly pass.
$nodeMajor = Get-NodeMajor

if ($nodeMajor -ge 20) {
    Ok "Node.js v$nodeMajor already installed"
} else {
    if ($nodeMajor -gt 0) {
        Warn "Node.js v$nodeMajor is too old (need >=20). Upgrading..."
    } else {
        Warn "Node.js not found. Installing..."
    }

    # Try winget first — fast and keeps Node on the system PATH the normal
    # way. NOTE: this can still trigger a UAC elevation prompt, since Node's
    # official winget package installs machine-wide (Program Files) rather
    # than declaring per-user scope. If winget isn't present, or its install
    # didn't actually succeed (e.g. the user can't elevate — no admin
    # rights, UAC prompt dismissed), fall through to a portable install that
    # needs no elevation at all: download the plain Node.js zip and unpack
    # it into the user's own AppData, then prepend it to the *User* PATH
    # (not Machine) — a pure per-user operation, no installer/UAC involved.
    $wingetOk = $false
    if (Get-Command winget -ErrorAction SilentlyContinue) {
        Log "Installing Node.js LTS via winget..."
        winget install OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements --silent --scope user 2>$null
        if ($LASTEXITCODE -eq 0) {
            $env:Path = [System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' +
                        [System.Environment]::GetEnvironmentVariable('Path','User')
            if ((Get-NodeMajor) -ge 20) { $wingetOk = $true }
        }
        if (-not $wingetOk) {
            Warn "winget install didn't take (often needs admin approval) — falling back to a portable install that needs no elevation."
        }
    }

    if (-not $wingetOk) {
        Log "Downloading a portable Node.js LTS build (no admin rights needed)..."
        $nodeDir = "$env:LOCALAPPDATA\Jivam\node"
        $zipPath = "$env:TEMP\node-lts.zip"
        # nodejs.org publishes a version-pinned "latest LTS" index; resolve it
        # so the zip filename (which embeds the version) is known up front.
        $ltsVersion = (Invoke-RestMethod -Uri "https://nodejs.org/dist/index.json" |
            Where-Object { $_.lts } | Select-Object -First 1).version
        $zipUrl = "https://nodejs.org/dist/$ltsVersion/node-$ltsVersion-win-x64.zip"
        Invoke-WebRequest -Uri $zipUrl -OutFile $zipPath -UseBasicParsing

        if (Test-Path $nodeDir) { Remove-Item $nodeDir -Recurse -Force }
        New-Item -ItemType Directory -Path $nodeDir -Force | Out-Null
        Expand-Archive -Path $zipPath -DestinationPath $nodeDir -Force
        Remove-Item $zipPath -Force

        # The zip extracts into a version-named subfolder — flatten it up one level.
        $extracted = Get-ChildItem $nodeDir -Directory | Select-Object -First 1
        Get-ChildItem $extracted.FullName | Move-Item -Destination $nodeDir -Force
        Remove-Item $extracted.FullName -Force

        # Prepend to the *User* PATH (not Machine — that would need admin).
        $userPath = [System.Environment]::GetEnvironmentVariable('Path','User')
        if ($userPath -notlike "*$nodeDir*") {
            [System.Environment]::SetEnvironmentVariable('Path', "$nodeDir;$userPath", 'User')
        }
        $env:Path = "$nodeDir;$env:Path"
    }

    $nodeMajor = Get-NodeMajor
    if ($nodeMajor -lt 20) {
        Write-Host ""
        Write-Host "  Node.js installation failed or PATH not updated yet." -ForegroundColor Red
        Write-Host "  Please install Node.js 20+ from https://nodejs.org, then re-run this script." -ForegroundColor Red
        exit 1
    }
}

Ok "Node.js $(node --version) ready"

# ── 2. Install jivam + jiva-core ─────────────────────────────────────────────
Header "Step 2 of 3 - Installing Jivam"
Log "Installing jivam and jiva-core globally..."
npm install -g jivamai jiva-core
Ok "jivam installed"
Ok "jiva-core installed"

# ── 3. Background service + Edge app setup ───────────────────────────────────
# Jivam sets up a Startup-folder entry (no admin needed — a Scheduled Task's
# logon trigger would require it) so the server runs in the background, then
# opens Edge (installed by default on every Windows PC — no separate browser
# needed) to a page with on-screen instructions for the one manual step —
# installing Jivam as an app via Edge's own "Install this site as an app" —
# and waits in the background for it to complete.
Header "Step 3 of 3 - Setting up the Jivam app"
Log "Opening Edge — follow the on-screen instructions to install Jivam as an app..."
jivam --install
Ok "Background service running"

# ── Done ─────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "$Bold${Green}All done!$Reset Jivam is installed." -NoNewline
Write-Host ""
Write-Host ""
Write-Host "  Double-click the $Bold`Jivam$Reset icon on your Desktop to launch."
Write-Host "  Jivam will auto-update in the background each time you open it."
Write-Host ""
