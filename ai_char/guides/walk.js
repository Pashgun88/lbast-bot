// Разведка ходьбой: node guides/walk.js "Идти на север" ... - после каждого клика печатает локацию, описание и ссылки.
const { chromium } = require('playwright');
const m = require('../module');
const NAV = /^(Aмулет|Амулет|Конь|Карта|Чат|Форум|Кланы|ЖГ|Галерея|Бои.*|Кто здесь\?|AI__.*|Q\d+|D\d+|Помощь.*|Выход|Размер текста|Обновить|В игру)$/;
const links = (page) => page.evaluate(() => Array.from(document.querySelectorAll('a')).map((a) => ({ t: (a.innerText || '').trim().replace(/\s+/g, ' '), h: a.getAttribute('href') || '' })).filter((x) => x.t && !/statuenull/.test(x.h)));
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const show = async (tag) => {
    const t = (await m.getBodyText(page)).split('\n').map((s) => s.trim()).filter(Boolean);
    const hdr = t.findIndex((s) => /^AI__ \(/.test(s));
    const place = hdr >= 0 ? t[hdr + 1] : t.slice(0, 3).join(' / ');
    const desc = hdr >= 0 ? (t[hdr + 2] || '').slice(0, 160) : t.slice(3, 5).join(' ').slice(0, 200);
    const l = [...new Set((await links(page)).map((x) => x.t).filter((x) => !NAV.test(x)))];
    console.log(`${tag} => ${place} | ${desc} | ${l.join(' | ')}`);
  };
  try {
    await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await show('старт');
    for (const c of process.argv.slice(2)) {
      const x = (await links(page)).find((y) => y.t.toLowerCase().startsWith(c.toLowerCase()));
      if (!x) { console.log('НЕТ ССЫЛКИ:', c); break; }
      await page.goto(new URL(x.h, page.url()).href, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(900);
      await show(c);
    }
  } finally { await ctx.close(); }
})();
