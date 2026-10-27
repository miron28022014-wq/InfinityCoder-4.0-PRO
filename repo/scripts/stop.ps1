# Остановка процессов InfinityCoder 4.0, запущенных скриптом start.ps1.
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -like "*$Root*" } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Write-Host "✔ Остановлено"
