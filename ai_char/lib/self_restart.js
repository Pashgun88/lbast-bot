// Перезапуск драйвера, когда браузера больше нет. Вынесено из driver.js 29.09.2026, чтобы тем же
// средством мог воспользоваться монитор чата: 29.09 браузер закрылся, главный цикл замолчал, а
// чат ещё двадцать минут писал в лог «Target page, context or browser has been closed». Проверка
// была только в главном цикле, и там она не сработала - значит нужен второй сторож, живой.
const path = require('path');

const BROWSER_GONE_RE = /(context or browser has been closed|Browser has been closed|Target closed|browserContext\.newPage)/i;
const DRIVER = path.join(__dirname, '..', 'driver.js');

let restarting = false;
function restartSelf(reason) {
  if (restarting) return;
  restarting = true;
  console.log(`Перезапуск драйвера: ${reason}.`);
  try {
    const { spawn } = require('child_process');
    const fs = require('fs');
    const dir = path.dirname(DRIVER);
    const out = fs.openSync(path.join(dir, 'driver_live.log'), 'a');
    const err = fs.openSync(path.join(dir, 'driver_err.log'), 'a');
    fs.writeSync(out, `\n===== RESTART (сам, браузер закрыт) ${new Date().toLocaleString('ru-RU')}\n`);
    spawn(process.execPath, [DRIVER], { cwd: dir, detached: true, stdio: ['ignore', out, err] }).unref();
  } catch (e) {
    console.log('Самоперезапуск не удался:', e.message);
  }
  setTimeout(() => process.exit(1), 3000);
}

// Пульс ГЛАВНОГО цикла. 29.09.2026 в 12:43 цикл встал на шаге «Fish Restaurant» и простоял 30 часов:
// процесс был жив, браузер жив, вкладка чата бодро писала в лог - и ни один сторож не помог:
// внешний смотрит только «есть ли процесс», а внутренний только писал в Telegram. Файл пульса даёт
// внешнему сторожу честный признак жизни: чат его не трогает, только шаги главного цикла.
const HEARTBEAT = path.join(path.dirname(DRIVER), 'driver_cycle.heartbeat');
function beat() {
  try { require('fs').writeFileSync(HEARTBEAT, String(Date.now())); } catch (e) { /* пульс не должен ронять драйвер */ }
}

const restartSelfBrowserGone = (reason) => restartSelf(`браузер закрыт (${reason}), вкладкой не спасти`);

module.exports = { BROWSER_GONE_RE, restartSelf, restartSelfBrowserGone, beat, HEARTBEAT };
