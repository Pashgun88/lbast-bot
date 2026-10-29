# Внешний сторож драйвера. 29.09.2026: драйвер умер целиком (процесса нет, лог обрывается
# ЗАПУСК: задача планировщика lbast-ai-char-keepalive зовёт НЕ этот файл напрямую, а
# keep_driver_alive.vbs рядом. Планировщик всегда создаёт powershell.exe окно консоли, и оно
# мелькало каждые 5 минут (Паша, 09.10.2026). Windows Script Host запускает процесс сразу
# скрытым, поэтому окна больше нет. Менять задачу обратно на powershell.exe - значит вернуть
# мелькание.
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

# Запись в лог НЕ должна ронять сторожа. 01.10.2026: лог держал открытым посторонний `tail -f`,
# Add-Content упал, а $ErrorActionPreference = 'Stop' оборвал скрипт ДО запуска - драйвер остался
# лежать. Сторож обязан поднять драйвер даже если пожаловаться в лог не вышло.
function Note($text) {
  try { Add-Content -Path $log -Encoding utf8 -Value $text -ErrorAction Stop } catch { Write-Host $text }
}

# Отметка «сторож отработал»: 29.10.2026 драйвер стоял с 06:35 до 09:51, а в логе за это время
# не было НИ ОДНОЙ строки сторожа - и нельзя было понять, молчал он или падал до первой записи.
# Теперь каждый заход оставляет время в файле, а падение пишется в лог.
try { Set-Content -Path (Join-Path $dir 'watchdog_last_run.txt') -Value (Get-Date -Format o) -Encoding utf8 -ErrorAction Stop } catch { }
# Опрос WMI может висеть или падать, а $ErrorActionPreference = 'Stop' тогда обрывает сторожа
# молча (окно скрыто через .vbs, жаловаться некуда). Даём опросу срок и говорим о провале в лог.
try {
  $alive = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" -OperationTimeoutSec 30 -ErrorAction Stop |
    Where-Object { $_.CommandLine -like '*driver.js*' })
} catch {
  Note "`n===== СТОРОЖ: не смог опросить процессы ($($_.Exception.Message)) - драйвер не трогаю, попробую через 5 мин ====="
  exit 0
}

# Процесс жив - это ещё не значит, что он работает. 29.09.2026 главный цикл встал в 12:43 на шаге
# «Fish Restaurant» и простоял 30 часов: процесс жив, браузер жив, вкладка чата бодро писала в лог. Поэтому
# смотрим не на процесс, а на пульс: его ставят только шаги главного цикла, шаги маршрутов и ожидание
# лечения. Срок щедрый (40 мин): самое долгое законное молчание - это лечение с нуля (~25 мин).
# Флаг разведки: пока лежит ai_char/recon.flag, сторож не трогает драйвер - я останавливаю его
# руками, чтобы занять профиль Chrome (запись маршрутов, разбор сумки). СРОК ФЛАГА 2 ЧАСА.
# 06.10.2026 я вместо флага выключил саму задачу планировщика, сессия оборвалась - и драйвер
# пролежал 13 часов. У выключенной задачи срока нет, у флага есть: забытый флаг устареет сам.
$reconFlag = Join-Path $dir 'recon.flag'
if (Test-Path $reconFlag) {
  $reconAge = ((Get-Date) - (Get-Item $reconFlag).LastWriteTime).TotalMinutes
  if ($reconAge -lt 120) {
    Note "`n===== СТОРОЖ: recon.flag ($([int]$reconAge) мин) - разведка, драйвер не трогаю ====="
    exit 0
  }
  Note "`n===== СТОРОЖ: recon.flag лежит $([int]$reconAge) мин - считаю забытым, поднимаю драйвер ====="
  Remove-Item $reconFlag -Force -ErrorAction SilentlyContinue
}
$beatFile = Join-Path $dir 'driver_cycle.heartbeat'
$stalled = $false
# Ночью пульса нет и не надо (Паша, 01.10.2026): с 23:00 до 05:00 персонаж спит, полезной работы
# не делает, и требовать от него пульс - значит будить рабочий драйвер ни за что. Даём ещё 15 минут
# после подъёма: встаёт он в 05:00 плюс 0-15 случайных минут.
$now = Get-Date
$sleeping = ($now.Hour -ge 23) -or ($now.Hour -lt 5) -or ($now.Hour -eq 5 -and $now.Minute -lt 15)
# 24.10.2026: если копий драйвера больше одной, они дерутся за профиль Chrome и обе висят на
# page.goto. Оставляем САМУЮ СВЕЖУЮ, остальные гасим - это и есть «профиль не терпит двух копий».
if ($alive.Count -gt 1) {
  $keep = ($alive | Sort-Object CreationDate -Descending)[0]
  Note "`n===== СТОРОЖ: драйверов $($alive.Count) - оставляю PID $($keep.ProcessId), остальные гашу ====="
  $alive | Where-Object { $_.ProcessId -ne $keep.ProcessId } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Seconds 2
  $alive = @($keep)
}
# Свежий процесс судить по старому пульсу нельзя: после разведки файл пульса остаётся
# многочасовой давности, и сторож убивал только что поднятый драйвер, не дав ему дойти до первого
# шага. Даём десять минут на старт.
$youngMin = if ($alive.Count -gt 0) { ((Get-Date) - $alive[0].CreationDate).TotalMinutes } else { 999 }

if ($alive.Count -gt 0 -and -not $sleeping) {
  if (Test-Path $beatFile) {
    $idleMin = [int]((Get-Date) - (Get-Item $beatFile).LastWriteTime).TotalMinutes
    if ($idleMin -ge 40 -and $youngMin -ge 10) {
      $stalled = $true
      Note "`n===== СТОРОЖ: главный цикл молчит $idleMin мин - перезапускаю драйвер ====="
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

# ШТОРМ ПЕРЕЗАПУСКОВ. Паша, 24.10.2026: «при шторме перезапусков в Telegram уходит ОДНА строка
# вместо десятка ошибок, и по ней ты одним словом поднимаешь меня». Считаем свои перезапуски:
# файл restart_log.txt, одна строка - одно время. Четыре и больше за час - это не случайность, а
# круг, и чинить его должен человек. Сообщение посылаем не чаще раза в два часа, иначе шторм
# сообщений заменит шторм ошибок.
$restartLog = Join-Path $dir 'restart_log.txt'
$stormMark = Join-Path $dir 'restart_storm_notified.txt'
Add-Content -Path $restartLog -Value (Get-Date -Format o) -ErrorAction SilentlyContinue
try {
  $hourAgo = (Get-Date).AddHours(-1)
  $times = @(Get-Content $restartLog -ErrorAction Stop | ForEach-Object { try { [datetime]::Parse($_) } catch { } } | Where-Object { $_ -gt $hourAgo })
  # Файл не растим: держим только последние сутки.
  $dayAgo = (Get-Date).AddDays(-1)
  @(Get-Content $restartLog | ForEach-Object { try { if ([datetime]::Parse($_) -gt $dayAgo) { $_ } } catch { } }) | Set-Content -Path $restartLog -Encoding utf8
  if ($times.Count -ge 4) {
    $quiet = $true
    if (Test-Path $stormMark) { $quiet = ((Get-Date) - (Get-Item $stormMark).LastWriteTime).TotalHours -ge 2 }
    if ($quiet) {
      $envFile = Join-Path (Split-Path -Parent $dir) '.env'
      $tok = $null; $chat = $null
      if (Test-Path $envFile) {
        foreach ($line in Get-Content $envFile) {
          if ($line -match '^\s*TELEGRAM_BOT_TOKEN\s*=\s*(.+)$') { $tok = $matches[1].Trim().Trim('"') }
          if ($line -match '^\s*TELEGRAM_CHAT_ID\s*=\s*(.+)$') { $chat = $matches[1].Trim().Trim('"') }
        }
      }
      if ($tok -and $chat) {
        $msg = "AI__: драйвер перезапускается по кругу - $($times.Count) раз за час. Сам не выправлюсь, нужен ты."
        try {
          Invoke-RestMethod -Method Post -Uri "https://api.telegram.org/bot$tok/sendMessage" -Body @{ chat_id = $chat; text = $msg } -TimeoutSec 20 | Out-Null
          Set-Content -Path $stormMark -Value (Get-Date -Format o) -Encoding utf8
          Note "===== СТОРОЖ: шторм перезапусков ($($times.Count) за час) - сказал Паше одной строкой ====="
        } catch { Note "===== СТОРОЖ: шторм перезапусков, но сообщение не ушло: $($_.Exception.Message) =====" }
      }
    }
  }
} catch { }

Note "`n===== RESTART (сторож keep_driver_alive) $(Get-Date -Format 'dd.MM.yyyy HH:mm:ss') ====="
# Запуск именно через bash с '>>': Start-Process -RedirectStandardOutput ЗАТИРАЕТ файл, а лог
# нужно дописывать - иначе теряется история дня и нечем ответить на «почему квест не делался».
$bash = 'C:\Program Files\Git\bin\bash.exe'
Start-Process -FilePath $bash -WindowStyle Hidden -ArgumentList '-lc', `
  '"cd /c/lbast-bot/ai_char && exec node driver.js >> driver_live.log 2>> driver_err.log"'
