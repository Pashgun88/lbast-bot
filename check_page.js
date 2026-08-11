const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

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