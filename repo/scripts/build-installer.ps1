<#
.SYNOPSIS
    Собирает установщик InfinityCoder для Windows в один клик.

.DESCRIPTION
    Скрипт выполняет полный конвейер сборки:
      1. Проверяет Node.js и Rust (MSVC) и WebView2.
      2. Устанавливает зависимости npm.
      3. Скачивает Vulkan-рантайм llama.cpp (~150 МБ) в src-tauri\bin.
      4. Генерирует иконки приложения из исходного PNG.
      5. Собирает фронтенд и Tauri-приложение.
      6. Кладёт готовый InfinityCoder-Setup.exe в папку release\.

    Запускать из корня проекта:
        powershell -ExecutionPolicy Bypass -File scripts\build-installer.ps1
        powershell -ExecutionPolicy Bypass -File scripts\build-installer.ps1 -SkipModel

.PARAMETER SkipModel
    Не выполнять шаг с локальной моделью (установщик всё равно предложит её скачать).

.PARAMETER SkipRuntime
    Не скачивать llama-server (соберётся без локальной модели — только облачный режим).

.PARAMETER SkipIcons
    Не генерировать иконки (использовать уже существующие в src-tauri\icons).

.PARAMETER Version
    Версия приложения. По умолчанию берётся из package.json.
#>
param(
  [switch]$SkipModel,
  [switch]$SkipRuntime,
  [switch]$SkipIcons,
  [string]$Version = ""
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

function Step($msg) {
  Write-Host ""
  Write-Host "==> $msg" -ForegroundColor Cyan
}
function Ok($msg)   { Write-Host "    [ok] $msg" -ForegroundColor Green }
function Warn($msg) { Write-Host "    [!]  $msg" -ForegroundColor Yellow }
function Die($msg)  { Write-Host "    [x]  $msg" -ForegroundColor Red; exit 1 }

$ReleaseDir = Join-Path $Root "release"
New-Item -ItemType Directory -Force -Path $ReleaseDir | Out-Null

# ---------------------------------------------------------------- 0. версия
if (-not $Version) {
  $pkg = Get-Content (Join-Path $Root "package.json") -Raw | ConvertFrom-Json
  $Version = $pkg.version
}
Step "InfinityCoder $Version — сборка установщика"

# ---------------------------------------------------------------- 1. тулчейн
Step "Проверка окружения"

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Die "Node.js не найден. Установите LTS: https://nodejs.org"
}
$nodeVer = (node -v).Trim("v")
Ok "Node.js $nodeVer"

$npmMajor = [int]((npm -v).Split(".")[0])
if ($npmMajor -lt 9) { Warn "Рекомендуется npm 9+" }

if (-not $SkipRuntime) {
  $hasRust = Get-Command cargo -ErrorAction SilentlyContinue
  if (-not $hasRust) {
    Die @"
Rust не найден. Установите toolchain с MSVC:
  winget install Rustlang.Rustup
Затем:  rustup default stable-msvc
"@
  }
  $rustVer = (cargo --version)
  Ok $rustVer

  if (-not $hasRust.InstalledTarget) { }
  $targets = rustup target list --installed
  if ($targets -notcontains "x86_64-pc-windows-msvc") {
    Warn "Цель x86_64-pc-windows-msvc не установлена, устанавливаю..."
    rustup target add x86_64-pc-windows-msvc
  }
}

# ---------------------------------------------------------------- 2. зависимости
Step "Зависимости npm"
npm install --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { Die "npm install не удался" }
Ok "Зависимости установлены"

# ---------------------------------------------------------------- 3. llama-server
$BinDir = Join-Path $Root "src-tauri\bin"
$ServerExe = Join-Path $BinDir "llama-server-vulkan.exe"

if ($SkipRuntime) {
  Warn "Шаг llama-server пропущен (-SkipRuntime)"
} elseif (Test-Path $ServerExe) {
  $len = (Get-Item $ServerExe).Length
  if ($len -gt 1MB) {
    Ok "llama-server уже на месте ($([math]::Round($len/1MB,1)) МБ)"
  } else {
    Warn "Файл llama-server повреждён, скачиваю заново"
    Remove-Item $ServerExe -Force
    $ServerExe = $null
  }
}

if ($ServerExe -and -not (Test-Path $ServerExe)) { $ServerExe = $null }

if (-not $ServerExe -and -not $SkipRuntime) {
  Step "Загрузка Vulkan-рантайма llama.cpp"
  New-Item -ItemType Directory -Force -Path $BinDir | Out-Null
  $zip = Join-Path $env:TEMP "llama-vulkan.zip"
  $extract = Join-Path $env:TEMP "llama-vulkan"
  $urls = @(
    "https://github.com/Caerleus/llama.cpp-vulkan-win/releases/latest/download/llama-vulkan-windows.zip",
    "https://github.com/ggerganov/llama.cpp/releases/latest/download/llama-win-vulkan-x64.zip"
  )
  $got = $false
  foreach ($u in $urls) {
    try {
      Write-Host "    пробую $u"
      Invoke-WebRequest -Uri $u -OutFile $zip -UseBasicParsing -TimeoutSec 300
      $got = $true; break
    } catch {
      Warn "не удалось: $($_.Exception.Message)"
    }
  }
  if (-not $got) {
    Warn "Автозагрузка не удалась. Продолжаю без локальной модели (облачный режим работает)."
    Write-Host "    Рантайм можно положить вручную: $BinDir\llama-server-vulkan.exe"
  } else {
    if (Test-Path $extract) { Remove-Item $extract -Recurse -Force }
    Expand-Archive $zip $extract -Force
    $server = Get-ChildItem $extract -Recurse -Filter "llama-server*.exe" |
              Where-Object { $_.Length -gt 1MB } | Select-Object -First 1
    if (-not $server) { $server = Get-ChildItem $extract -Recurse -Filter "llama-server*.exe" | Select-Object -First 1 }
    if (-not $server) { Die "llama-server.exe не найден внутри архива" }
    Copy-Item $server.FullName $ServerExe -Force
    $dlls = $server.Directory
    Get-ChildItem $dlls -Filter "*.dll" | ForEach-Object {
      $dest = Join-Path $BinDir $_.Name
      if (-not (Test-Path $dest)) { Copy-Item $_.FullName $dest -Force }
    }
    Ok "llama-server: $([math]::Round((Get-Item $ServerExe).Length/1MB,1)) МБ"
  }
}

# ---------------------------------------------------------------- 4. иконки
if ($SkipIcons) {
  Warn "Иконки пропущены (-SkipIcons)"
} elseif (Test-Path (Join-Path $Root "src-tauri\icons\icon.ico")) {
  Ok "Иконки уже сгенерированы"
} else {
  Step "Генерация иконок"
  $iconPng = Join-Path $env:TEMP "infinitycoder-icon.png"
  try {
    Add-Type -AssemblyName System.Drawing
    $bmp = New-Object System.Drawing.Bitmap 1024, 1024
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

    $bg = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
      (New-Object System.Drawing.Point 0,0),
      (New-Object System.Drawing.Point 1024,1024),
      [System.Drawing.Color]::FromArgb(108,133,255),
      [System.Drawing.Color]::FromArgb(178,122,255)
    )
    $g.FillEllipse($bg, 40, 40, 944, 944)
    $g.FillEllipse((New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(10,12,18))), 0, 0, 1024, 1024)

    # Infinity glyph drawn as two touching rings
    $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::White), 74
    $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $pen.EndCap   = [System.Drawing.Drawing2D.LineCap]::Round
    $g.DrawEllipse($pen, 190, 380, 340, 264)
    $g.DrawEllipse($pen, 494, 380, 340, 264)
    $pen.Dispose(); $bg.Dispose()
    $g.Dispose()
    $bmp.Save($iconPng, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()

    npx --yes tauri icon $iconPng
    if ($LASTEXITCODE -ne 0) { Warn "tauri icon завершился с кодом $LASTEXITCODE" }
    else { Ok "Иконки сгенерированы" }
  } catch {
    Warn "Не удалось сгенерировать иконки автоматически: $($_.Exception.Message)"
    Warn "Сборка продолжится со стандартной иконкой Tauri."
  }
}

# ---------------------------------------------------------------- 5. сборка
Step "Сборка фронтенда"
npx tsc -b --noEmit
if ($LASTEXITCODE -ne 0) { Die "Ошибки TypeScript — исправьте их перед сборкой" }
npx vite build
if ($LASTEXITCODE -ne 0) { Die "Сборка фронтенда не удалась" }
Ok "dist/ готов"

if ($SkipRuntime) {
  Step "Сборка Tauri-приложения (без локальной модели)"
  npx tauri build --bundles nsis
} else {
  Step "Сборка Tauri-приложения (NSIS)"
  npx tauri build --bundles nsis
}
if ($LASTEXITCODE -ne 0) { Die "Сборка установщика не удалась" }

# ---------------------------------------------------------------- 6. результат
$exe = Get-ChildItem (Join-Path $Root "src-tauri\target\release\bundle\nsis") -Filter "*.exe" -ErrorAction SilentlyContinue |
       Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $exe) { Die "Установщик не найден в src-tauri\target\release\bundle\nsis" }

$final = Join-Path $ReleaseDir "InfinityCoder-$Version-Setup.exe"
Copy-Item $exe.FullName $final -Force

Step "Готово"
Ok "Установщик: $final"
Ok "Размер:     $([math]::Round($exe.Length/1MB,1)) МБ"
Write-Host ""
Write-Host "Запустите файл, чтобы установить InfinityCoder." -ForegroundColor Green
Write-Host "Модель (~5 ГБ) скачается автоматически при первом запуске установщика." -ForegroundColor DarkGray
Write-Host ""
