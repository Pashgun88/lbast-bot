// Перезапуск драйвера, когда браузера больше нет. Вынесено из driver.js 29.09.2026, чтобы тем же
// средством мог воспользоваться монитор чата: 29.09 браузер закрылся, главный цикл замолчал, а
// чат ещё двадцать минут писал в лог «Target page, context or browser has been closed». Проверка
// была только в главном цикле, и там она не сработала - значит нужен второй сторож, живой.
const path = require('path');

const BROWSER_GONE_RE = /(context or browser has been closed|Browser has been closed|Target closed|browserContext\.newPage)/i;
const DRIVER = path.join(__dirname, '..', 'driver.js');

let restarting = false;
function restartSelfBrowserGone(reason) {
  if (restarting) return;
  restarting = true;
  console.log(`Браузер закрыт (${reason}) - вкладкой не спасти, перезапускаю драйвер.`);
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

module.exports = { BROWSER_GONE_RE, restartSelfBrowserGone };
