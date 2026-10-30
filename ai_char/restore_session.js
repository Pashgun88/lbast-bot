// Поставить вход AI__ в профиль Chrome из файла session_cookies.json.
//
// Зачем: профиль Chrome нельзя просто скопировать на другую машину. Куки в нём зашифрованы
// ключом Windows (DPAPI), который привязан к пользователю и компьютеру - на новой машине они
// не расшифровываются, и игра встречает формой входа. Сам вход держится на двух куках
// (user_id и user_pass), и их можно перенести отдельно - этим скриптом.
//
// Как пользоваться на новой машине:
//   1) положить рядом session_cookies.json (выгружен на старой машине, в git его нет);
//   2) остановить драйвер - профиль не терпит двух процессов;
//   3) node ai_char/restore_session.js
//   4) скрипт сам проверит, что игра узнала персонажа.

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const PROFILE = path.join(__dirname, 'chrome-profile-ai-char');
const FILE = process.env.AI_COOKIES_FILE || path.join(__dirname, 'session_cookies.json');

(async () => {
  if (!fs.existsSync(FILE)) {
    console.log(`Нет файла с куками: ${FILE}. Выгрузи его на старой машине (node ai_char/_cookies_dump.js) и положи сюда.`);
    process.exit(1);
  }
  const cookies = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  const ctx = await chromium.launchPersistentContext(PROFILE, { headless: true, viewport: null });
  await ctx.addCookies(cookies);
  const page = ctx.pages()[0] || (await ctx.newPage());
  await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  const text = await page.evaluate(() => (document.body.innerText || '').slice(0, 400)).catch(() => '');
  const ok = /AI__/.test(text) && !/парол|Вход|Логин/i.test(text.slice(0, 200));
  console.log(ok ? 'Вход восстановлен: игра показывает AI__.' : 'Похоже, не вышло. Экран:');
  if (!ok) console.log(text.replace(/\n{2,}/g, '\n'));
  await ctx.close();
})();
