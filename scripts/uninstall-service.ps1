#Requires -RunAsAdministrator
<#
.SYNOPSIS
  Stops and removes the sensor service. Use -RemoveFiles to also delete the copy in Program Files
  that install-service.ps1 made. Logs in %ProgramData% are left in place.
#>
param(
    [switch]$RemoveFiles,
    [string]$ConfigPath = (Join-Path (Split-Path -Parent $PSScriptRoot) 'shared\config\defaults.json')
)
$ErrorActionPreference = 'Stop'

$cfg = Get-Content $ConfigPath -Raw | ConvertFrom-Json
$name = $cfg.service.name

if (Get-Service $name -ErrorAction SilentlyContinue) {
    Stop-Service $name -Force -ErrorAction SilentlyContinue
    sc.exe delete $name | Out-Null
    Write-Host "Removed service $name"
} else {
    Write-Host "Service $name is not installed"
}

if ($RemoveFiles) {
    $dir = Join-Path $env:ProgramFiles (Join-Path $cfg.appName $cfg.service.installSubfolder)
    if (Test-Path $dir) { Remove-Item $dir -Recurse -Force; Write-Host "Deleted $dir" }
}
