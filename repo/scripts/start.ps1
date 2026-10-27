#!/usr/bin/env pwsh
# Запуск InfinityCoder 4.0 на Windows: Core API + мост + веб-IDE.
param(
  [ValidateSet("start","stop","core","coder","bridge")]
  [string]$Mode = "start"
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)

$envFile = Join-Path $Root ".env"
if (Test-Path $envFile) {
  Get-Content $envFile | ForEach-Object {
    if ($_ -match '^\s*([^#=]+)=(.*)$') { Set-Item -Path "env:$($matches[1].Trim())" -Value $matches[2].Trim() }
  }
}

$corePort   = if ($env:INFINITY_PORT) { $env:INFINITY_PORT } else { 8787 }
$coderPort  = if ($env:INFINITY_CODER_PORT) { $env:INFINITY_CODER_PORT } else { 8090 }
$bridgePort = if ($env:INFINITY_BRIDGE_PORT) { $env:INFINITY_BRIDGE_PORT } else { 5299 }

function Stop-InfCoder {
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like "*$Root*" } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}

switch ($Mode) {
  "start" {
    Stop-InfCoder
    Start-Sleep -Milliseconds 400
    Write-Host "▸ Core API   → http://127.0.0.1:$corePort"
    Start-Process -WindowStyle Hidden -FilePath "node" -ArgumentList "$Root\ecosystem\dist\server.js" -WorkingDirectory $Root
    Start-Sleep -Seconds 1
    Write-Host "▸ Мост      → http://127.0.0.1:$bridgePort"
    Start-Process -WindowStyle Hidden -FilePath "node" -ArgumentList "$Root\scripts\bridge.cjs" -WorkingDirectory $Root
    Write-Host "▸ Веб-IDE   → http://127.0.0.1:$coderPort"
    Start-Process -WindowStyle Hidden -FilePath "node" -ArgumentList "$Root\scripts\serve-dist.cjs","$coderPort" -WorkingDirectory $Root
    Write-Host ""
    Write-Host "Откройте http://127.0.0.1:$coderPort — Ctrl+C в этом окне не останавливает службы."
    Write-Host "Остановка: powershell -File $Root\scripts\stop.ps1"
  }
  "stop" {
    Stop-InfCoder
    Write-Host "✔ Остановлено"
  }
  "core"   { & node "$Root\ecosystem\dist\server.js" }
  "coder"  { & node "$Root\scripts\serve-dist.cjs" "$coderPort" }
  "bridge" { & node "$Root\scripts\bridge.cjs" }
}
