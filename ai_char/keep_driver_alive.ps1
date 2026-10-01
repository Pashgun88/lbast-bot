# Внешний сторож драйвера. 29.09.2026: драйвер умер целиком (процесса нет, лог обрывается
# на полуслове, driver_err.log пуст) - и поднять его было некому: сторож «цикл молчит» и
# самоперезапуск «браузер закрыт» живут ВНУТРИ процесса. Этот скрипт живёт снаружи, его
# запускает планировщик Windows каждые 5 минут.
#
# Правила:
#  - опознаём драйвер строго по 'driver.js' в командной строке. 29.09 я добавил в фильтр ещё
#    и 'lbast' - а процесс, запущенный через -WorkingDirectory, пути проекта не содержит:
#    фильтр промахнулся, старая копия выжила, и я убил ей браузер;
#  - если процесс есть - НИЧЕГО не делаем (двух копий профиль Chrome не терпит);
#  - перед запуском убираем осиротевшие файлы блокировки профиля: после падения Chrome они
#    остаются, и новый драйвер не может открыть браузер, а крутится вслепую;
#  - лог всегда дописываем.
$ErrorActionPreference = 'Stop'
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$log = Join-Path $dir 'driver_live.log'
$err = Join-Path $dir 'driver_err.log'

$alive = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -like '*driver.js*' })

# Процесс жив - это ещё не значит, что он работает. 29.09.2026 главный цикл встал в 12:43 на шаге
# «Fish Restaurant» и простоял 30 часов: процесс жив, браузер жив, вкладка чата бодро писала в лог. Поэтому
# смотрим не на процесс, а на пульс: его ставят только шаги главного цикла, шаги маршрутов и ожидание
# лечения. Срок щедрый (40 мин): самое долгое законное молчание - это лечение с нуля (~25 мин).
$beatFile = Join-Path $dir 'driver_cycle.heartbeat'
$stalled = $false
# Ночью пульса нет и не надо (Паша, 01.10.2026): с 23:00 до 05:00 персонаж спит, полезной работы
# не делает, и требовать от него пульс - значит будить рабочий драйвер ни за что. Даём ещё 15 минут
# после подъёма: встаёт он в 05:00 плюс 0-15 случайных минут.
$now = Get-Date
$sleeping = ($now.Hour -ge 23) -or ($now.Hour -lt 5) -or ($now.Hour -eq 5 -and $now.Minute -lt 15)
if ($alive.Count -gt 0 -and -not $sleeping) {
  if (Test-Path $beatFile) {
    $idleMin = [int]((Get-Date) - (Get-Item $beatFile).LastWriteTime).TotalMinutes
    if ($idleMin -ge 40) {
      $stalled = $true
      Add-Content -Path $log -Encoding utf8 -Value "`n===== СТОРОЖ: главный цикл молчит $idleMin мин - перезапускаю драйвер ====="
      $alive | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
      Start-Sleep -Seconds 3
    }
  } else {
    # Пульса ещё нет (старая сборка или драйвер только что стартовал) - не трогаем.
  }
}
if ($alive.Count -gt 0 -and -not $stalled) { exit 0 }

# Осиротевший Chrome от упавшего драйвера держит профиль - закрываем.
$profileDir = Join-Path $dir 'chrome-profile-ai-char'
Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" |
  Where-Object { $_.CommandLine -like "*$profileDir*" } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 3
foreach ($n in 'SingletonLock', 'SingletonCookie', 'SingletonSocket') {
  $f = Join-Path $profileDir $n
  if (Test-Path $f) { Remove-Item $f -Force -ErrorAction SilentlyContinue }
}

Add-Content -Path $log -Encoding utf8 -Value "`n===== RESTART (сторож keep_driver_alive) $(Get-Date -Format 'dd.MM.yyyy HH:mm:ss') ====="
# Запуск именно через bash с '>>': Start-Process -RedirectStandardOutput ЗАТИРАЕТ файл, а лог
# нужно дописывать - иначе теряется история дня и нечем ответить на «почему квест не делался».
$bash = 'C:\Program Files\Git\bin\bash.exe'
Start-Process -FilePath $bash -WindowStyle Hidden -ArgumentList '-lc', `
  '"cd /c/lbast-bot/ai_char && exec node driver.js >> driver_live.log 2>> driver_err.log"'
