// Драйвер для персонажа AI__ — раскачка отдельного низкоуровневого персонажа.
// НЕ связан с manager_bot.js / daily_quests_piraty.js (это отдельный аккаунт lbast.ru,
// отдельный профиль браузера ai_char/chrome-profile-ai-char). Основного персонажа не трогает.
//
// Запуск: node ai_char/driver.js
// Переменная окружения AI_MAX_CYCLES (по умолчанию 6) — сколько циклов сделать за запуск.

const { chromium } = require('playwright');
const path = require('path');
const {
  doScenario,
  runDailyQuests,
  getBodyText,
  parseStats,
  handleUnreadMailIfAny,
  pause,
} = require('./module');

const LOGIN = process.env.AI_LOGIN;
const PASS = process.env.AI_PASS;
const MAX_CYCLES = Number(process.env.AI_MAX_CYCLES || 6);

async function loginIfNeeded(page) {
  await page.goto('http://lbast.ru/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  const loginInput = page.locator('input[name="login"]');
  if ((await loginInput.count().catch(() => 0)) > 0) {
    if (!LOGIN || !PASS) {
      console.error(
        'Нет сохранённой сессии и не заданы AI_LOGIN/AI_PASS (переменные окружения или .env в корне репо) — учётные данные не хранятся в коде.'
      );
      process.exit(1);
    }
    await loginInput.fill(LOGIN);
    await page.locator('input[name="pass"]').fill(PASS);
    await Promise.all([
      page.waitForLoadState('domcontentloaded'),
      page.locator('input[type=submit]').first().click(),
    ]);
    console.log('Logged in as', LOGIN, '-> URL:', page.url());
  }
}

(async () => {
  const userDataDir = path.join(__dirname, 'chrome-profile-ai-char');
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false, // локально можно смотреть на экран; для сервера/без монитора поставь true
    viewport: null,
  });
  const page = context.pages()[0] || (await context.newPage());

  await loginIfNeeded(page);

  for (let i = 1; i <= MAX_CYCLES; i++) {
    console.log(`\n===== CYCLE ${i}/${MAX_CYCLES} =====`);
    try {
      await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
      await handleUnreadMailIfAny(page);

      const text = await getBodyText(page);
      const stats = parseStats(text);
      console.log('stats:', stats);

      if (Number.isFinite(stats.questsAvailable) && stats.questsAvailable > 0) {
        const result = await runDailyQuests(page, stats);
        console.log('runDailyQuests result:', result);
      } else {
        console.log('No Q quests available this cycle.');
      }
    } catch (e) {
      console.log('Cycle error:', e.message);
    }
    await pause(page, 800, 1500);
  }

  const finalText = await getBodyText(page);
  console.log('\n===== FINAL STATE =====');
  console.log(finalText.slice(0, 1500));

  await context.close();
})();
