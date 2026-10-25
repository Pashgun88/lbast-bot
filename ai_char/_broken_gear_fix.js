// Выбросить сломанное и, если это был клановый герб, взять новый. Паша, 25.10.2026.
const { chromium } = require('playwright');
const { getBodyText } = require('./module');
const { takeClanEmblemIfDue } = require('./lib/clan_emblem');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const flat = (s, n = 1200) => (s || '').replace(/\s+/g, ' ').trim().slice(0, n);

(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  await page.goto('http://lbast.ru/inv.php?mod=outfit', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await sleep(600);
  const before = (await getBodyText(page).catch(() => '')).replace(/[ \t]+/g, ' ');
  const brokenLines = before.split('\n').filter((l) => /Поломано/i.test(l));
  console.log('СЛОМАНО: ' + (brokenLines.join(' ; ') || '(ничего)'));

  const href = await page.evaluate(() => {
    const a = Array.from(document.querySelectorAll('a')).find((x) => /Выбросить\s+полом/i.test((x.textContent || '').trim()));
    return a ? a.getAttribute('href') : null;
  });
  console.log('ссылка «Выбросить поломаное»: ' + href);
  if (!href) { await ctx.close(); return; }

  await page.goto('http://lbast.ru/' + href.replace(/^\//, ''), { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await sleep(800);
  const after = (await getBodyText(page).catch(() => '')).replace(/[ \t]+/g, ' ');
  console.log('ПОСЛЕ: ' + flat(after, 900));
  console.log('осталось сломанного: ' + (after.split('\n').filter((l) => /Поломано/i.test(l)).join(' ; ') || 'нет'));

  if (/герб/i.test(brokenLines.join(' '))) {
    console.log('--- сломан был герб, беру новый ---');
    await takeClanEmblemIfDue(page);
  }
  await ctx.close();
})();
