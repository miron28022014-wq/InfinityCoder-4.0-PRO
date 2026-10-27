<#
.SYNOPSIS
  Установщик InfinityCoder 4.0 (Windows).

.DESCRIPTION
  Ставит веб-IDE, Core API экосистемы (sidecar) и терминальный мост.
  Требуется Node.js 22.5+.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\install.ps1
  powershell -ExecutionPolicy Bypass -File scripts\install.ps1 -Dir C:\InfinityCoder -NoService
#>
param(
  [string]$Dir = "$env:LOCALAPPDATA\InfinityCoder",
  [switch]$NoService,
  [switch]$Uninstall
)

$ErrorActionPreference = "Stop"

function Say($m) { Write-Host "▸ $m" -ForegroundColor Cyan }
function Ok($m)  { Write-Host "✔ $m" -ForegroundColor Green }
function Warn($m){ Write-Host "! $m" -ForegroundColor Yellow }
function Die($m) { Write-Host "✖ $m" -ForegroundColor Red; exit 1 }

$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)

if ($Uninstall) {
  Say "Останавливаю службы"
  foreach ($s in @("InfinityCore", "InfinityCoder", "InfinityBridge")) {
    try { Stop-Service -Name $s -ErrorAction Stop; sc.exe delete $s | Out-Null } catch {}
  }
  Get-Process -Name node -ErrorAction SilentlyContinue |
    Where-Object { $_.Path -and $_.Path -like "*node*" -and $_.CommandLine -like "*$Dir*" } |
    Stop-Process -Force -ErrorAction SilentlyContinue
  Say "Удаляю $Dir (данные в $Dir\.data сохраняются)"
  if (Test-Path $Dir) { Remove-Item -Recurse -Force $Dir }
  Ok "Готово"
  exit 0
}

Say "Проверяю окружение"
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Die "Node.js не найден. Нужен Node.js 22.5 или новее." }
$nodeVer = (node -v) -replace "^v", ""
$parts = $nodeVer.Split(".")
if ([int]$parts[0] -lt 22 -or ([int]$parts[0] -eq 22 -and [int]$parts[1] -lt 5)) {
  Die "Node.js $nodeVer слишком старый. Нужен 22.5 или новее."
}
Ok "Node.js $nodeVer"

Say "Разворачиваю InfinityCoder 4.0 в $Dir"
New-Item -ItemType Directory -Force -Path $Dir | Out-Null
foreach ($item in @("src","public","scripts","ecosystem","index.html","package.json","package-lock.json","tsconfig.json","vite.config.ts","tailwind.config.js","postcss.config.js","README.md","CHANGELOG.md")) {
  $src = Join-Path $Root $item
  if (Test-Path $src) { Copy-Item -Recurse -Force $src (Join-Path $Dir $item) }
}
if (Test-Path (Join-Path $Root "docs")) { Copy-Item -Recurse -Force (Join-Path $Root "docs") (Join-Path $Dir "docs") }
foreach ($junk in @("node_modules","dist")) {
  $p = Join-Path $Dir $junk
  if (Test-Path $p) { Remove-Item -Recurse -Force $p }
}
$ecoDist = Join-Path $Dir "ecosystem\dist"
if (Test-Path $ecoDist) { Remove-Item -Recurse -Force $ecoDist }
Ok "Файлы развёрнуты"

Push-Location $Dir
try {
  Say "Устанавливаю зависимости"
  npm install --no-audit --no-fund --loglevel=error --strict-ssl=false
  Ok "Зависимости установлены"

  Say "Собираю веб-IDE (vite)"
  npm run build --silent
  Ok "Веб-IDE собран"

  Say "Собираю Core API экосистемы"
  npm run ecosystem:build --silent
  Ok "Core API собран"

  $envFile = Join-Path $Dir ".env"
  $dataDir = Join-Path $Dir ".data"
  New-Item -ItemType Directory -Force -Path $dataDir | Out-Null
  if (-not (Test-Path $envFile)) {
    $bytes = New-Object byte[] 32
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $key = -join ($bytes | ForEach-Object { $_.ToString("x2") })
    @"
# InfinityCoder 4.0 — конфигурация. Создано установщиком.
# Мастер-ключ шифрует секреты провайдеров в экосистеме. НЕ теряйте и не публикуйте.
INFINITY_MASTER_KEY=$key
INFINITY_DB=$dataDir\infinity.db
INFINITY_CODER_WORKSPACE=$dataDir\coder-workspaces
INFINITY_HOST=127.0.0.1
INFINITY_PORT=8787
INFINITY_DEFAULT_MODE=cloud
INFINITY_CORS_ORIGINS=*
INFINITY_CODER_HOST=127.0.0.1
INFINITY_CODER_PORT=8090
INFINITY_BRIDGE_PORT=5299
INFINITY_API_URL=http://127.0.0.1:8787
"@ | Set-Content -Encoding UTF8 $envFile
    Ok "Создан $envFile с мастер-ключом"
  } else {
    Ok "Конфигурация $envFile уже есть — сохраняю её"
  }

  Say "Применяю миграции БД экосистемы"
  Get-Content $envFile | ForEach-Object {
    if ($_ -match '^\s*([^#=]+)=(.*)$') { Set-Item -Path "env:$($matches[1].Trim())" -Value $matches[2].Trim() }
  }
  npm run ecosystem:migrate --silent
  Ok "Схема БД актуальна"
} finally {
  Pop-Location
}

if (-not $NoService) {
  Say "Регистрирую службы Windows"
  $node = (Get-Command node).Source
  $defs = @(
    @{ Name = "InfinityCore";   Desc = "Infinity Ecosystem Core API"; Args = "`"$Dir\ecosystem\dist\server.js`"" },
    @{ Name = "InfinityCoder";  Desc = "InfinityCoder 4.0 — веб-IDE";     Args = "`"$Dir\scripts\serve-dist.cjs`" 8090" },
    @{ Name = "InfinityBridge"; Desc = "InfinityCoder — терминальный мост"; Args = "`"$Dir\scripts\bridge.cjs`"" }
  )
  foreach ($d in $defs) {
    $bin = "$env:SystemRoot\System32\sc.exe"
    & $bin create $d.Name binPath= "`"$node`" $($d.Args)" start= auto DisplayName= "`"$($d.Desc)`"" | Out-Null
    & $bin description $d.Name "`"$($d.Desc)`"" | Out-Null
  }
  Ok "Службы зарегистрированы: InfinityCore, InfinityCoder, InfinityBridge"
} else {
  Warn "Службы не регистрировались — запуск через scripts\start.ps1"
}

Write-Host ""
Ok "Установка InfinityCoder 4.0 завершена"
Write-Host ""
Write-Host "  Каталог установки : $Dir"
Write-Host "  Конфигурация      : $envFile"
Write-Host "  Данные и проекты  : $dataDir"
Write-Host ""
Write-Host "  Веб-IDE           : http://127.0.0.1:8090"
Write-Host "  Core API          : http://127.0.0.1:8787"
Write-Host "  Терминальный мост : http://127.0.0.1:5299"
Write-Host ""
Write-Host "  Запуск вручную    : powershell -ExecutionPolicy Bypass -File $Dir\scripts\start.ps1"
Write-Host "  Остановка         : powershell -ExecutionPolicy Bypass -File $Dir\scripts\stop.ps1"
Write-Host ""
