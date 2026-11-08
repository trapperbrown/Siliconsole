<#
.SYNOPSIS
  Builds everything and produces the NSIS installer:
  generated types, service tests + self-contained publish, notices, frontend checks, Tauri bundle.
#>
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
    node shared/scripts/gen-types.mjs
    if ($LASTEXITCODE) { throw 'type generation failed' }

    dotnet test sensor-service
    if ($LASTEXITCODE) { throw 'service tests failed' }
    dotnet publish sensor-service/src -c Release -o sensor-service/publish --self-contained -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true
    if ($LASTEXITCODE) { throw 'service publish failed' }

    Push-Location desktop
    pnpm install --frozen-lockfile
    if ($LASTEXITCODE) { throw 'pnpm install failed' }
    Pop-Location
    node scripts/gen-notices.mjs
    if ($LASTEXITCODE) { throw 'notices generation failed' }

    Push-Location desktop
    pnpm check
    if ($LASTEXITCODE) { throw 'frontend checks failed' }
    pnpm tauri build
    if ($LASTEXITCODE) { throw 'tauri build failed' }
    Pop-Location

    Get-ChildItem desktop/src-tauri/target/release/bundle/nsis/*.exe | ForEach-Object { "Installer: $($_.FullName) ($([math]::Round($_.Length / 1MB, 1)) MB)" }
} finally {
    Pop-Location
}
