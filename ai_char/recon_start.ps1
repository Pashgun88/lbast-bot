# Возврат драйвера после разведки: снять recon.flag и поднять процесс.
# Файл обязан храниться в UTF-8 С BOM (PowerShell 5.1 иначе читает .ps1 как ANSI).
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
Remove-Item (Join-Path $dir 'recon.flag') -Force -Confirm:$false -ErrorAction SilentlyContinue
$bash = "C:\Program Files\Git\bin\bash.exe"
Start-Process -FilePath $bash -WindowStyle Hidden -ArgumentList '-lc', `
  '"cd /c/lbast-bot/ai_char && exec node driver.js >> driver_live.log 2>> driver_err.log"'
Start-Sleep -Seconds 7
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -like '*driver.js*' } |
  ForEach-Object { Write-Output "драйвер поднят, PID $($_.ProcessId)" }
