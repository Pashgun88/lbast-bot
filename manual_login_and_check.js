const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const readline = require('readline');

function waitForEnter() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question('Войди в игру вручную в открывшемся окне, потом нажми Enter здесь... ', () => {
      rl.close();
      resolve();
    });
  });
}

(async () => {
  const userDataDir = path.join(__dirname, 'chrome-profile');

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    viewport: null,
    slowMo: 100,
  });

  let page = context.pages()[0];

  if (!page) {
    page = await context.newPage();
  }

  await page.goto('http://lbast.ru', {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });

  console.log('Браузер открыт.');
  await waitForEnter();

  await page.bringToFront();
  await page.waitForTimeout(2000);

  const text = await page.locator('body').innerText().catch(() => '');
  const html = await page.content().catch(() => '');

  fs.writeFileSync(path.join(__dirname, 'page_text.txt'), text, 'utf8');
  fs.writeFileSync(path.join(__dirname, 'page.html'), html, 'utf8');

  console.log('Текущий URL:', page.url());
  console.log('Первые 1500 символов страницы:');
  console.log(text.slice(0, 1500));
  console.log('Сохранены файлы page_text.txt и page.html');
})();