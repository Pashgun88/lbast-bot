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
if ($alive.Count -gt 0) { exit 0 }

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
