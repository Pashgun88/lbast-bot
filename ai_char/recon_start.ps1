# Возврат драйвера после разведки: снять recon.flag и поднять процесс.
# Файл обязан храниться в UTF-8 С BOM (PowerShell 5.1 иначе читает .ps1 как ANSI).
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
Remove-Item (Join-Path $dir 'recon.flag') -Force -Confirm:$false -ErrorAction SilentlyContinue
# 24.10.2026: Паша получил пачку ошибок в Telegram. Причина - ДВЕ копии драйвера на одном профиле
# Chrome: сторож поднял свою, этот скрипт добавил ещё одну, и обе уткнулись в page.goto timeout
# (профиль двух копий не терпит). Поэтому перед запуском гасим всё, что бежит, и снимаем
# блокировки профиля от осиротевшего Chrome - иначе новый драйвер крутится вслепую.
$running = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like '*driver.js*' })
if ($running.Count -gt 0) {
  Write-Output "уже бежало драйверов: $($running.Count) - гашу, профиль Chrome держит только одну копию"
  $running | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Seconds 3
}
$prof = Join-Path $dir 'chrome-profile-ai-char'
Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" |
  Where-Object { $_.CommandLine -like "*$prof*" } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 2
foreach ($n in 'SingletonLock', 'SingletonCookie', 'SingletonSocket') {
  $f = Join-Path $prof $n
  if (Test-Path $f) { Remove-Item $f -Force -ErrorAction SilentlyContinue }
}
# Пульс от прошлой жизни драйвера сторож принимает за молчание свежего и сразу его убивает.
# Трогаем файл пульса сейчас, чтобы у нового процесса был честный старт.
$beat = Join-Path $dir 'driver_cycle.heartbeat'
if (Test-Path $beat) { (Get-Item $beat).LastWriteTime = Get-Date }

$bash = "C:\Program Files\Git\bin\bash.exe"
Start-Process -FilePath $bash -WindowStyle Hidden -ArgumentList '-lc', `
  '"cd /c/lbast-bot/ai_char && exec node driver.js >> driver_live.log 2>> driver_err.log"'
Start-Sleep -Seconds 7
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -like '*driver.js*' } |
  ForEach-Object { Write-Output "драйвер поднят, PID $($_.ProcessId)" }
