// Открыть браузер в профиле AI__ и оставить его открытым - для входа в игру руками.
// Нужен при переезде на новую машину, если профиль Chrome не переносили: драйвер сам логиниться
// не умеет (пароль в коде не хранится), ему нужна готовая сессия в этом профиле.
// Драйвер при этом должен быть остановлен: профиль не терпит двух процессов.
const path = require('path');
const { chromium } = require('playwright');

(async () => {
  const userDataDir = path.join(__dirname, 'chrome-profile-ai-char');
  const ctx = await chromium.launchPersistentContext(userDataDir, { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  await page.goto('http://lbast.ru/', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  console.log('Окно открыто. Войди в игру под AI__ и просто закрой окно - сессия останется в профиле.');
  await ctx.waitForEvent('close', { timeout: 0 }).catch(() => {});
})();
