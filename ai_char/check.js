// Быстрая проверка статуса персонажа AI__ без каких-либо действий.
// Запуск: node ai_char/check.js
const { chromium } = require('playwright');
const path = require('path');
const { getBodyText, parseStats, pause } = require('./module');

(async () => {
  const userDataDir = path.join(__dirname, 'chrome-profile-ai-char');
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    viewport: null,
  });
  const page = context.pages()[0] || (await context.newPage());

  await page.goto('http://lbast.ru/pers.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await pause(page, 400, 700);
  const text = await getBodyText(page);
  console.log(text.slice(0, 1200));
  console.log(parseStats(text));

  await context.close();
})();
