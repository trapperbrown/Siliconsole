<#
.SYNOPSIS
  Builds the GitHub release body. Shared by scripts/release.ps1 (-Local) and .github/workflows/release.yml,
  so local and CI releases say the same thing.
.EXAMPLE
  ./scripts/release-notes.ps1 -Notes "Fixed the overlay." -InstallerName Siliconsole_1.0.1_x64-setup.exe -Sha256 abc123
.EXAMPLE
  ./scripts/release-notes.ps1 -Notes $notes -InstallerName $name -Sha256 $sha -Signed -OutFile body.md
#>
param(
    [string]$Notes = 'Bug fixes and improvements.',
    [Parameter(Mandatory)][string]$InstallerName,
    [Parameter(Mandatory)][string]$Sha256,
    [switch]$Signed,
    [string]$OutFile
)
$ErrorActionPreference = 'Stop'
if (-not $Notes.Trim()) { $Notes = 'Bug fixes and improvements.' }

if ($Signed) {
    $smartScreen = '- The installer is code-signed. Windows SmartScreen may still warn while the certificate builds reputation: click **More info**, then **Run anyway**.'
    $signing = "`n`nFree code signing provided by [SignPath.io](https://signpath.io), certificate by [SignPath Foundation](https://signpath.org). See the [Code signing policy](https://github.com/trapperbrown/Siliconsole/blob/main/docs/CODE_SIGNING.md)."
} else {
    $smartScreen = "- Windows SmartScreen will warn that the app is unrecognized (the installer isn't code-signed). Click **More info**, then **Run anyway**."
    $signing = ''
}

$body = @"
$($Notes.Trim())

**Download:** ``$InstallerName`` below (Windows 10/11 x64). Installing over an older version keeps your dashboards and settings.

### Before you install
$smartScreen
- The installer adds a background service that runs as LocalSystem to read hardware sensors. If the PawnIO driver is missing, it asks before downloading PawnIO's official signed setup.
- Siliconsole only *reads* sensors: no fan control, overclocking or voltage changes.
- Provided as is, with no warranty, under the MIT License. See the README's Disclaimer section.

SHA-256: ``$($Sha256.ToLower())``$signing
"@

if ($OutFile) {
    [IO.File]::WriteAllText($ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($OutFile), $body, (New-Object System.Text.UTF8Encoding $false))
} else {
    $body
}
