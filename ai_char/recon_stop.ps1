# Остановка драйвера под разведку - БЕЗОПАСНО.
#
# ВНИМАНИЕ: файл обязан храниться в UTF-8 С BOM. Windows PowerShell 5.1 без BOM читает .ps1
# как ANSI, и весь кириллический текст превращается в мусор - скрипт даже не разбирается.
#
# 07.10.2026: я остановил драйвер посреди боя с Молегом. Бой на паузу не встаёт - противник
# продолжает бить, и персонаж из 460/460 ушёл в нокаут. Поэтому сначала ждём конца боя,
# и только потом останавливаем. У ожидания есть срок: у каждого гейта должен быть предел.
param([int]$WaitMinutes = 6)

$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$log = Join-Path $dir 'driver_live.log'

function FightInProgress {
  if (-not (Test-Path $log)) { return $false }
  $tail = Get-Content $log -Tail 40 -ErrorAction SilentlyContinue
  if (-not $tail) { return $false }
  # Идёт бой, если после последнего "Бой завершен" были удары.
  $lastDone = -1; $lastHit = -1
  for ($i = 0; $i -lt $tail.Count; $i++) {
    if ($tail[$i] -match 'Бой завершен') { $lastDone = $i }
    if ($tail[$i] -match '-> Ударить|-> Бить|fight result=') { $lastHit = $i }
  }
  return ($lastHit -gt $lastDone)
}

$deadline = (Get-Date).AddMinutes($WaitMinutes)
while ((FightInProgress) -and ((Get-Date) -lt $deadline)) {
  Write-Output "Идёт бой - жду его конца, чтобы не бросить персонажа под удар..."
  Start-Sleep -Seconds 20
}
if (FightInProgress) { Write-Output "ВНИМАНИЕ: бой всё ещё идёт, но срок ожидания ($WaitMinutes мин) вышел - останавливаю." }

New-Item -ItemType File (Join-Path $dir 'recon.flag') -ErrorAction SilentlyContinue | Out-Null
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -like '*driver.js*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -Confirm:$false; Write-Output "остановлен PID $($_.ProcessId)" }
