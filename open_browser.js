const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const userDataDir = path.join(__dirname, 'chrome-profile');

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    viewport: null,
    slowMo: 100,
  });

  const page = await context.newPage();

  await page.goto('http://lbast.ru', {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });

  console.log('Браузер открыт.');
  console.log('Войди в игру вручную и не закрывай окно.');
})();