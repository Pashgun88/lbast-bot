// Проверяет исход последнего боя AI__ через лог (не доверяем "Бой завершен!" на глаз).
// Печатает, кто "выбывает из строя" и есть ли "Ничья!" в шапке лога.
// Запуск: node ai_char/verify_last_fight.js
const { chromium } = require('playwright');
const path = require('path');
const { getBodyText, pause } = require('./module');

(async () => {
  const userDataDir = path.join(__dirname, 'chrome-profile-ai-char');
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    viewport: null,
  });
  const page = context.pages()[0] || (await context.newPage());

  await page.goto('http://lbast.ru/log_infa.php?blogin=AI__&mod=battlesList', {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await pause(page, 400, 700);
  const links = await page.$$eval('a', (as) =>
    as
      .map((a) => ({ href: a.getAttribute('href'), t: a.textContent.trim() }))
      .filter((l) => l.href && l.href.includes('log_by_id'))
  );
  if (!links.length) {
    console.log('Боёв не найдено.');
    await context.close();
    return;
  }

  await page.goto('http://lbast.ru' + links[0].href, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await pause(page, 300, 500);
  const text = await getBodyText(page);
  console.log(text.slice(0, 1800));

  const lost = /AI__\s*выбывает из строя/i.test(text);
  const draw = /Ничья!/i.test(text);
  console.log('\n=== ВЕРДИКТ ===');
  if (draw) console.log('НИЧЬЯ — прогресс квеста НЕ засчитан.');
  else if (lost) console.log('ПОРАЖЕНИЕ — прогресс квеста НЕ засчитан.');
  else console.log('Похоже на победу (AI__ не выбывал) — но перепроверь лог глазами для уверенности.');

  await context.close();
})();
