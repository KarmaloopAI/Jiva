# Jivam installer for Windows
# Usage (run in PowerShell as normal user — no admin needed):
#   irm https://raw.githubusercontent.com/karmaloop-ai/jivam/main/scripts/install.ps1 | iex
#
# Requires PowerShell 5.1+ (built into Windows 10/11).

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
Header "Step 1 of 4 - Node.js"

function Get-NodeMajor {
    try {
        $v = (node --version 2>$null).TrimStart('v')
        return [int]($v.Split('.')[0])
    } catch { return 0 }
}

$nodeMajor = Get-NodeMajor

if ($nodeMajor -ge 18) {
    Ok "Node.js v$nodeMajor already installed"
} else {
    if ($nodeMajor -gt 0) {
        Warn "Node.js v$nodeMajor is too old (need >=18). Upgrading..."
    } else {
        Warn "Node.js not found. Installing..."
    }

    # Try winget first (available on Windows 10 1709+ / Windows 11)
    $wingetOk = $false
    try {
        $null = Get-Command winget -ErrorAction Stop
        Log "Installing Node.js LTS via winget..."
        winget install OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements --silent
        $wingetOk = $true
    } catch {}

    if (-not $wingetOk) {
        # Download the MSI directly
        Log "Downloading Node.js LTS installer..."
        $msiUrl = "https://nodejs.org/dist/lts/node-lts-x64.msi"
        $msiPath = "$env:TEMP\node-lts.msi"
        Invoke-WebRequest -Uri $msiUrl -OutFile $msiPath -UseBasicParsing
        Log "Running Node.js installer (follow the prompts)..."
        Start-Process msiexec.exe -ArgumentList "/i `"$msiPath`" /passive /norestart" -Wait
        Remove-Item $msiPath -Force
    }

    # Refresh PATH
    $env:Path = [System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' +
                [System.Environment]::GetEnvironmentVariable('Path','User')

    $nodeMajor = Get-NodeMajor
    if ($nodeMajor -lt 18) {
        Write-Host ""
        Write-Host "  Node.js installation failed or PATH not updated yet." -ForegroundColor Red
        Write-Host "  Please install Node.js 20+ from https://nodejs.org, then re-run this script." -ForegroundColor Red
        exit 1
    }
}

Ok "Node.js $(node --version) ready"

# ── 2. Chrome recommendation ─────────────────────────────────────────────────
Header "Step 2 of 4 - Chrome (recommended)"

$chromePaths = @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LocalAppData\Google\Chrome\Application\chrome.exe"
)
$chromeInstalled = $chromePaths | Where-Object { Test-Path $_ } | Select-Object -First 1

if ($chromeInstalled) {
    Ok "Google Chrome is already installed"
} else {
    Write-Host "  Jivam works best with Google Chrome (opens as a clean, tab-free app window)."
    Write-Host "  Without Chrome it will open in Edge, which also supports app-window mode."
    Write-Host ""
    $choice = Read-Host "  Download Chrome now? [Y/n]"
    if ($choice -eq '' -or $choice -match '^[Yy]') {
        Log "Opening Chrome download page..."
        Start-Process "https://www.google.com/chrome/"
        Write-Host ""
        Read-Host "  Install Chrome, then press Enter to continue"
    } else {
        Warn "Skipping Chrome. Edge will be used for the app window."
    }
}

# ── 3. Install jivam + jiva-core ─────────────────────────────────────────────
Header "Step 3 of 4 - Installing Jivam"
Log "Installing jivam and jiva-core globally..."
npm install -g jivamai jiva-core
Ok "jivam installed"
Ok "jiva-core installed"

# ── 4. Shortcuts ─────────────────────────────────────────────────────────────
Header "Step 4 of 4 - Setting up shortcuts"
Log "Creating Desktop shortcut and Start Menu entry..."
jivam --install
Ok "Shortcuts created"

# ── Done ─────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "$Bold${Green}All done!$Reset Jivam is installed." -NoNewline
Write-Host ""
Write-Host ""
Write-Host "  Double-click the $Bold`Jivam$Reset icon on your Desktop to launch."
Write-Host "  Jivam will auto-update in the background each time you open it."
Write-Host ""
