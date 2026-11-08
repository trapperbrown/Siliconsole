#Requires -RunAsAdministrator
<#
.SYNOPSIS
  Installs (or updates) and starts the sensor service.
.DESCRIPTION
  BinaryDir must hold the published service exe and defaults.json. A service running as LocalSystem
  must not run from a user-writable folder, so if BinaryDir is outside Program Files the files are
  first copied to "%ProgramFiles%\<appName>\<installSubfolder>".
.EXAMPLE
  dotnet publish sensor-service/src -c Release -o sensor-service/publish
  ./scripts/install-service.ps1 -BinaryDir sensor-service/publish
#>
param(
    [string]$BinaryDir = (Join-Path (Split-Path -Parent $PSScriptRoot) 'sensor-service\publish')
)
$ErrorActionPreference = 'Stop'

$BinaryDir = (Resolve-Path $BinaryDir).Path
$cfg = Get-Content (Join-Path $BinaryDir 'defaults.json') -Raw | ConvertFrom-Json
$svc = $cfg.service

if (-not $BinaryDir.StartsWith($env:ProgramFiles, [StringComparison]::OrdinalIgnoreCase)) {
    $target = Join-Path $env:ProgramFiles (Join-Path $cfg.appName $svc.installSubfolder)
    if (Get-Service $svc.name -ErrorAction SilentlyContinue) { Stop-Service $svc.name -ErrorAction SilentlyContinue }
    New-Item -ItemType Directory -Force $target | Out-Null
    Copy-Item (Join-Path $BinaryDir '*') $target -Recurse -Force
    $BinaryDir = $target
    Write-Host "Copied service files to $target"
}
$exe = Join-Path $BinaryDir $svc.exeName
if (-not (Test-Path $exe)) { throw "Service executable not found: $exe" }

$existing = Get-Service $svc.name -ErrorAction SilentlyContinue
if ($existing) {
    Stop-Service $svc.name -ErrorAction SilentlyContinue
    sc.exe config $svc.name binPath= "`"$exe`"" start= auto | Out-Null
    Write-Host "Updated existing service $($svc.name)"
} else {
    New-Service -Name $svc.name -BinaryPathName "`"$exe`"" -DisplayName $svc.displayName `
        -Description $svc.description -StartupType Automatic | Out-Null
    Write-Host "Created service $($svc.name)"
}

$delay = $svc.recoveryRestartDelayMs
sc.exe failure $svc.name reset= 86400 actions= "restart/$delay/restart/$delay/restart/$delay" | Out-Null

if (-not (Get-Service $cfg.pawnio.serviceName -ErrorAction SilentlyContinue)) {
    Write-Warning "PawnIO driver not found. CPU, motherboard and some memory sensors need it: $($cfg.pawnio.setupUrl)"
}

Start-Service $svc.name
Get-Service $svc.name | Format-Table Name, Status, StartType -AutoSize
