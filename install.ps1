# Install dsh-client-ui-cpa-quota into the current dsh web profile.
# Idempotent: safe to re-run.
#
# New dsh (0.1.1-rc.x) flow: the plugin's node half imports
# @deepseek-ai/dsh-settings, so the package must materialize as a real
# directory inside a node_modules that also carries the hoisted
# @deepseek-ai dependencies. Preference order:
#   1. `dsh plugin --profile web add` (official pnpm forwarder)
#   2. copy into <profile>\node_modules\<name>
#   3. copy into the shared <dsh home>\profiles\node_modules\<name>
# Symlinks are no longer used: Node resolves modules from the link target's
# realpath, which cannot see the profile's hoisted dependencies (and Windows
# symlinks additionally require Developer Mode). Finally the loader entry is
# registered in the profile's cordis.patch.yml.
param(
    [string]$Repo = "https://github.com/wkscc310/dsh-client-ui-cpa-quota",
    [string]$DshHome = "$env:USERPROFILE\.dsh",
    [string]$Profile = "web"
)

$ErrorActionPreference = "Stop"
$Name = "dsh-client-ui-cpa-quota"
$PluginDir = Join-Path $DshHome "plugins\$Name"
$ProfileDir = Join-Path $DshHome "profiles\$Profile"
$ProfileLink = Join-Path $ProfileDir "node_modules\$Name"
$LegacyLink = Join-Path $DshHome "profiles\node_modules\$Name"
$Patch = Join-Path $ProfileDir "cordis.patch.yml"

# REPO ends up as command/file arguments; reject anything that is not a
# plain http(s) URL before it is ever interpolated.
if ($Repo -notmatch '^https?://') {
    throw "REPO must be an http(s) URL, got: $Repo"
}

function Say([string]$Message) { Write-Host "[install] $Message" }

function Copy-DirectoryContents([string]$Source, [string]$Destination) {
    New-Item -ItemType Directory -Force -Path $Destination | Out-Null
    Get-ChildItem -LiteralPath $Source -Force |
        Where-Object { $_.Name -notin @(".git", "node_modules") } |
        ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $Destination -Recurse -Force }
}

# Replace whatever sits at the destination (old copy or symlink) with a fresh
# copy of the plugin. Only ever called on our own package's path.
function Place-Copy([string]$Destination) {
    if (Test-Path -LiteralPath $Destination) {
        Remove-Item -LiteralPath $Destination -Recurse -Force
    }
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Destination) | Out-Null
    Copy-DirectoryContents $PluginDir $Destination
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

# 2. Materialize the package where the dsh loader can resolve it.
$Installed = ""
if (Get-Command dsh -ErrorAction SilentlyContinue) {
    try {
        # Run from the profile directory like the dsh plugin flow expects;
        # the absolute path needs no rewriting.
        Push-Location $ProfileDir
        dsh plugin --profile $Profile add $PluginDir
        if ($LASTEXITCODE -eq 0) {
            $Installed = "dsh"
            Say "installed into the $Profile profile via dsh plugin add"
        }
        else {
            Say "dsh plugin add failed - falling back to a direct copy"
        }
    }
    catch {
        Say "dsh plugin add unavailable - falling back to a direct copy"
    }
    finally {
        Pop-Location
    }
}
else {
    Say "dsh CLI not found on PATH - falling back to a direct copy"
}

if (-not $Installed) {
    try {
        Place-Copy $ProfileLink
        $Installed = "profile"
        Say "copied plugin: $ProfileLink"
    }
    catch {
        Place-Copy $LegacyLink
        $Installed = "shared"
        Say "copied plugin: $LegacyLink"
    }
}

# A pre-existing symlinked install cannot resolve the node half's imports
# (Node walks the link target's realpath), so retire it when present.
if (($Installed -ne "shared") -and (Test-Path -LiteralPath $LegacyLink)) {
    $legacyItem = Get-Item -LiteralPath $LegacyLink -Force
    if (($legacyItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        Remove-Item -LiteralPath $LegacyLink -Force
        Say "removed legacy symlink: $LegacyLink"
    }
}

# 3. Register the loader entry (idempotent). A fresh profile's patch file
#    holds a literal `[]` placeholder — appending after it would produce an
#    invalid two-document YAML file, so the placeholder is replaced instead.
$patchDir = Split-Path -Parent $Patch
New-Item -ItemType Directory -Force -Path $patchDir | Out-Null
if (-not (Test-Path $Patch)) { New-Item -ItemType File -Path $Patch | Out-Null }
$content = Get-Content -Raw $Patch
if ($content -match [regex]::Escape($Name)) {
    Say "patch entry already present in $Patch"
}
else {
    $lines = Get-Content $Patch
    $effective = @($lines | Where-Object { $_.Trim() -ne "" -and -not $_.TrimStart().StartsWith("#") })
    if ($effective.Count -eq 1 -and $effective[0].Trim() -eq "[]") {
        $replaced = foreach ($line in $lines) {
            if ($line.Trim() -eq "[]") {
                "- insert:"
                "    - id: ui-cpa-quota"
                "      name: $Name"
            }
            else { $line }
        }
        [System.IO.File]::WriteAllLines($Patch, @($replaced), (New-Object System.Text.UTF8Encoding($false)))
        Say "patch entry written into $Patch (replaced the placeholder [])"
    }
    else {
        $entry = "`n- insert:`n    - id: ui-cpa-quota`n      name: $Name`n"
        # Append UTF-8 without BOM; DSH patch files are expected to be UTF-8.
        [System.IO.File]::AppendAllText($Patch, $entry, (New-Object System.Text.UTF8Encoding($false)))
        Say "patch entry appended to $Patch"
    }
}

Say "done. Restart the DSH web host, then paste your management key in"
Say "Settings -> Plugins -> CliProxyAPI Quota."
