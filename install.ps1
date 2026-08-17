# Install dsh-client-ui-cpa-quota into the DSH web profile.
# Idempotent: safe to re-run. Symlinks the plugin into the profile's
# node_modules (falls back to copying when symlinks are unavailable) and
# registers the loader entry.
param(
    [string]$Repo = "https://github.com/wkscc310/dsh-client-ui-cpa-quota",
    [string]$DshHome = "$env:USERPROFILE\.dsh"
)

$ErrorActionPreference = "Stop"
$Name = "dsh-client-ui-cpa-quota"
$PluginDir = Join-Path $DshHome "plugins\$Name"
$LinkDir = Join-Path $DshHome "profiles\node_modules\$Name"
$Patch = Join-Path $DshHome "profiles\web\cordis.patch.yml"

function Say([string]$Message) { Write-Host "[install] $Message" }

function Copy-DirectoryContents([string]$Source, [string]$Destination) {
    New-Item -ItemType Directory -Force -Path $Destination | Out-Null
    Get-ChildItem -LiteralPath $Source -Force |
        Where-Object { $_.Name -notin @(".git", "node_modules") } |
        ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $Destination -Recurse -Force }
}

function Sync-RemoteSource {
    $stage = Join-Path $env:TEMP "$Name-source-$PID"
    if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
    New-Item -ItemType Directory -Force -Path $stage | Out-Null
    try {
        $cloneDir = Join-Path $stage $Name
        try {
            git clone --depth 1 $Repo $cloneDir
            if ($LASTEXITCODE -ne 0) { throw "git clone failed" }
            Copy-DirectoryContents $cloneDir $PluginDir
            Say "updated from $Repo"
            return $true
        }
        catch {
            Say "git unavailable/failed - downloading zip"
            $zip = Join-Path $stage "$Name.zip"
            Invoke-WebRequest "$Repo/archive/refs/heads/main.zip" -OutFile $zip
            $extract = Join-Path $stage "extract"
            Expand-Archive $zip $extract
            Copy-DirectoryContents (Join-Path $extract "$Name-main") $PluginDir
            Say "downloaded and updated from $Repo"
            return $true
        }
    }
    finally {
        if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
    }
}

# 1. Source: reuse this script's own folder when run from the repo,
#    otherwise clone (git) or download (zip) it.
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if ((Test-Path (Join-Path $ScriptDir "lib\client.js")) -and (Test-Path (Join-Path $ScriptDir "package.json"))) {
    if ($ScriptDir -ne $PluginDir) {
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $PluginDir) | Out-Null
        Copy-DirectoryContents $ScriptDir $PluginDir
    }
    Say "source ready: $PluginDir"
}
else {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $PluginDir) | Out-Null
    if (-not (Sync-RemoteSource)) {
        if (-not (Test-Path (Join-Path $PluginDir "lib"))) { throw "unable to obtain $Name from $Repo" }
        Say "using existing source: $PluginDir"
    }
}

# 2. Link into the profile's node_modules so the DSH loader can resolve it.
$nmDir = Split-Path -Parent $LinkDir
New-Item -ItemType Directory -Force -Path $nmDir | Out-Null
$linkItem = Get-Item -LiteralPath $LinkDir -ErrorAction SilentlyContinue
if ($linkItem -and (($linkItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0)) {
    Say "profile symlink already exists: $LinkDir"
}
elseif (Test-Path $LinkDir) {
    Copy-DirectoryContents $PluginDir $LinkDir
    Say "updated copied plugin: $LinkDir"
}
else {
    $linked = $true
    try {
        New-Item -ItemType SymbolicLink -Path $LinkDir -Target $PluginDir | Out-Null
        Say "symlinked $LinkDir -> $PluginDir"
    }
    catch {
        $linked = $false
    }
    if (-not $linked) {
        Copy-DirectoryContents $PluginDir $LinkDir
        Say "symlink unavailable - copied to $LinkDir"
    }
}

# 3. Register the loader entry (append only when missing).
$patchDir = Split-Path -Parent $Patch
New-Item -ItemType Directory -Force -Path $patchDir | Out-Null
if (-not (Test-Path $Patch)) { New-Item -ItemType File -Path $Patch | Out-Null }
$content = Get-Content -Raw $Patch
if ($content -match [regex]::Escape($Name)) {
    Say "patch entry already present in $Patch"
}
else {
    $entry = "`n- insert:`n    - id: ui-cpa-quota`n      name: $Name`n"
    # Append UTF-8 without BOM; DSH patch files are expected to be UTF-8.
    [System.IO.File]::AppendAllText($Patch, $entry, (New-Object System.Text.UTF8Encoding($false)))
    Say "patch entry appended to $Patch"
}

Say "done. Restart the DSH web host, then paste your management key in"
Say "Settings -> Plugins -> CliProxyAPI Quota."
