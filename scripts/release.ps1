<#
.SYNOPSIS
  Ships a new version. By default: bumps the version, runs the tests and checks locally (fast fail), commits,
  creates an annotated tag whose message is the release notes, and pushes. GitHub Actions
  (.github/workflows/release.yml) then builds the installer, signs it when SignPath is set up, and publishes
  the GitHub release.
  -Local does the old flow instead: full local build, then commit, tag, push and `gh release create` from this machine.
  -DryRun runs everything except commit, tag, push and publish, then restores the version files.
.EXAMPLE
  ./scripts/release.ps1 -Version 1.0.1 -Notes "Fixed the overlay on 4K screens."
.EXAMPLE
  ./scripts/release.ps1 -Version 1.0.1 -DryRun           # bump and check only; files are restored afterwards
.EXAMPLE
  ./scripts/release.ps1 -Version 1.0.1 -Local -Notes "..." # build and publish from this machine, no CI
#>
param(
    [Parameter(Mandatory)][string]$Version,
    [string]$Notes = 'Bug fixes and improvements.',
    [switch]$Local,
    [switch]$DryRun
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$utf8 = New-Object System.Text.UTF8Encoding $false
$originals = @{}
Push-Location $root
try {
    if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw "Version must look like 1.2.3, got '$Version'" }
    $tag = "v$Version"
    if (-not $DryRun) {
        if (git status --porcelain) { throw 'Commit or stash your changes first; the release commit should only bump the version.' }
        if (git tag --list $tag) { throw "Tag $tag already exists." }
    }

    # Bump the version in the places that carry it (first match only, so dependency versions are untouched).
    $files = @{
        'desktop/package.json'               = '("version"\s*:\s*")[^"]+(")'
        'desktop/src-tauri/tauri.conf.json'  = '("version"\s*:\s*")[^"]+(")'
        'desktop/src-tauri/Cargo.toml'       = '(?m)(^version\s*=\s*")[^"]+(")'
        'desktop/src-tauri/Cargo.lock'       = '(?m)(^name = "siliconsole-desktop"\r?\nversion = ")[^"]+(")'
    }
    foreach ($f in $files.Keys) {
        $path = Join-Path $root $f
        $text = [IO.File]::ReadAllText($path)
        $m = ([regex]$files[$f]).Match($text)
        if (-not $m.Success) { throw "No version found in $f" }
        $originals[$path] = @($files[$f], $text.Substring($m.Groups[1].Index + $m.Groups[1].Length, $m.Groups[2].Index - $m.Groups[1].Index - $m.Groups[1].Length))
        $new = ([regex]$files[$f]).Replace($text, "`${1}$Version`${2}", 1)
        [IO.File]::WriteAllText($path, $new, $utf8)
        "Set $f to $Version"
    }

    if ($Local) {
        & "$PSScriptRoot/build-installer.ps1"
        $exe = Get-Item "desktop/src-tauri/target/release/bundle/nsis/Siliconsole_${Version}_x64-setup.exe"
        $sha = (Get-FileHash $exe.FullName -Algorithm SHA256).Hash.ToLower()
        $body = & "$PSScriptRoot/release-notes.ps1" -Notes $Notes -InstallerName $exe.Name -Sha256 $sha
    } else {
        # Fast local checks; CI runs the full build-installer.ps1 after the tag is pushed.
        node shared/scripts/gen-types.mjs
        if ($LASTEXITCODE) { throw 'type generation failed' }
        dotnet test sensor-service
        if ($LASTEXITCODE) { throw 'service tests failed' }
        Push-Location desktop
        try {
            pnpm install --frozen-lockfile
            if ($LASTEXITCODE) { throw 'pnpm install failed' }
            pnpm check
            if ($LASTEXITCODE) { throw 'frontend checks failed' }
        } finally {
            Pop-Location
        }
    }

    if ($DryRun) {
        if ($Local) {
            "Dry run: built $($exe.FullName). Nothing committed or published."
            $body
        } else {
            "Dry run: checks passed. Nothing committed, tagged or pushed. Tag message (release notes) would be:"
            $Notes
        }
        return
    }

    git add desktop/package.json desktop/src-tauri/tauri.conf.json desktop/src-tauri/Cargo.toml desktop/src-tauri/Cargo.lock
    git commit -m "Release $tag"
    if ($LASTEXITCODE) { throw 'commit failed' }
    # Annotated tag; its message is the release notes CI publishes. Verbatim keeps Markdown "#" headings.
    $tagFile = New-TemporaryFile
    [IO.File]::WriteAllText($tagFile, $Notes, $utf8)
    git tag -a $tag -F $tagFile --cleanup=verbatim
    $tagExit = $LASTEXITCODE
    Remove-Item $tagFile
    if ($tagExit) { throw 'tag failed' }
    git push origin HEAD $tag
    if ($LASTEXITCODE) { throw 'push failed' }

    if ($Local) {
        $notesFile = New-TemporaryFile
        [IO.File]::WriteAllText($notesFile, $body, $utf8)
        gh release create $tag $exe.FullName --title "Siliconsole $Version" --notes-file $notesFile
        if ($LASTEXITCODE) { throw 'gh release create failed' }
        Remove-Item $notesFile
    } else {
        "Pushed $tag. GitHub Actions now builds, signs (if configured) and publishes the release."
        "Follow it with: gh run watch   (or the Actions tab on GitHub)"
    }
} finally {
    if ($DryRun) {
        # Put back only the old version string, so other edits made to these files meanwhile survive.
        foreach ($path in $originals.Keys) {
            $pattern, $old = $originals[$path]
            $text = [IO.File]::ReadAllText($path)
            [IO.File]::WriteAllText($path, ([regex]$pattern).Replace($text, "`${1}$old`${2}", 1), $utf8)
        }
        if ($originals.Count) { 'Restored the version files.' }
    }
    Pop-Location
}
