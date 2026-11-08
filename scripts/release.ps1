<#
.SYNOPSIS
  Ships a new version: bumps the version, builds and tests the installer, commits, tags, pushes,
  and publishes a GitHub release with the installer attached.
.EXAMPLE
  ./scripts/release.ps1 -Version 1.0.1 -Notes "Fixed the overlay on 4K screens."
.EXAMPLE
  ./scripts/release.ps1 -Version 1.0.1 -DryRun    # bump and build only; nothing is committed or published
#>
param(
    [Parameter(Mandatory)][string]$Version,
    [string]$Notes = 'Bug fixes and improvements.',
    [switch]$DryRun
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
    if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw "Version must look like 1.2.3, got '$Version'" }
    $tag = "v$Version"
    if (-not $DryRun) {
        if (git status --porcelain) { throw 'Commit or stash your changes first; the release commit should only bump the version.' }
        if (git tag --list $tag) { throw "Tag $tag already exists." }
    }

    # Bump the version in the three places that carry it (first match only, so dependency versions are untouched).
    $utf8 = New-Object System.Text.UTF8Encoding $false
    $files = @{
        'desktop/package.json'               = '("version"\s*:\s*")[^"]+(")'
        'desktop/src-tauri/tauri.conf.json'  = '("version"\s*:\s*")[^"]+(")'
        'desktop/src-tauri/Cargo.toml'       = '(?m)(^version\s*=\s*")[^"]+(")'
    }
    foreach ($f in $files.Keys) {
        $path = Join-Path $root $f
        $text = [IO.File]::ReadAllText($path)
        $new = ([regex]$files[$f]).Replace($text, "`${1}$Version`${2}", 1)
        [IO.File]::WriteAllText($path, $new, $utf8)
        "Set $f to $Version"
    }

    & "$PSScriptRoot/build-installer.ps1"
    $exe = Get-Item "desktop/src-tauri/target/release/bundle/nsis/Siliconsole_${Version}_x64-setup.exe"
    $sha = (Get-FileHash $exe.FullName -Algorithm SHA256).Hash.ToLower()

    $body = @"
$Notes

**Download:** ``$($exe.Name)`` below (Windows 10/11 x64). Installing over an older version keeps your dashboards and settings.

### Before you install
- Windows SmartScreen will warn that the app is unrecognized (the installer isn't code-signed). Click **More info**, then **Run anyway**.
- The installer adds a background service that runs as LocalSystem to read hardware sensors. If the PawnIO driver is missing, it asks before downloading PawnIO's official signed setup.
- Siliconsole only *reads* sensors: no fan control, overclocking or voltage changes.
- Provided as is, with no warranty, under the MIT License. See the README's Disclaimer section.

SHA-256: ``$sha``
"@

    if ($DryRun) {
        "Dry run: built $($exe.FullName). Nothing committed or published. Revert the version bump with: git checkout -- desktop"
        $body
        return
    }

    git add desktop/package.json desktop/src-tauri/tauri.conf.json desktop/src-tauri/Cargo.toml desktop/src-tauri/Cargo.lock
    git commit -m "Release $tag"
    if ($LASTEXITCODE) { throw 'commit failed' }
    git tag $tag
    git push origin HEAD $tag
    if ($LASTEXITCODE) { throw 'push failed' }

    $notesFile = New-TemporaryFile
    [IO.File]::WriteAllText($notesFile, $body, $utf8)
    gh release create $tag $exe.FullName --title "Siliconsole $Version" --notes-file $notesFile
    if ($LASTEXITCODE) { throw 'gh release create failed' }
    Remove-Item $notesFile
} finally {
    Pop-Location
}
