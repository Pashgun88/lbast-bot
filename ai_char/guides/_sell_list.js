// Разово: продать в магазине Стоунгарда то, что названо в ALLOW (точное совпадение имени).
// Магазин открывается только ИЗ Стоунгарда (lway=2), список - shop.php?mod=prodat, страницы cpage=1..N.
// Клик по названию открывает подтверждение «Вы точно хотите продать 1 шт. ...?» со ссылкой «- Да».
// Ничего, кроме ALLOW, не трогаем: в том же списке лежат медали Ордо по 1 дин и кольцо, которое нужно.
const { chromium } = require('playwright');
const m = require('../module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Название -> сколько штук продать. Для вещей Ордо строго по одной: надетые экземпляры в списке
// продажи не появляются, но лимит - вторая страховка, чтобы не раздеть персонажа.
const ALLOW = new Map([
  ['Боевой посох Ордо экзекуторс', 1],
  ['Кираса ордо экзекуторс', 1],
  ['Щит ухода', 1],
  ['Сапоги защиты', 1],
]);
const MAX_SALES = 40;

(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const open = async (url, wait = 1800) => {
    await page.goto(new URL(url, 'http://lbast.ru/').href, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(wait);
  };
  const money = async () => {
    const t = await m.getBodyText(page);
    return Number((t.match(/Деньги:\s*(\d+)/) || t.match(/У вас\s+(\d+)\s+дин/) || [])[1] || 0);
  };
  try {
    await open('location.php?mod=fastway&lway=2', 6000);
    await open('shop.php?mod=prodat');
    const before = await money();
    console.log('денег до продажи:', before);

    let sold = 0;
    for (let pass = 0; pass < MAX_SALES; pass++) {
      let target = null;
      for (const cpage of [1, 2, 3, 4, 5, 6]) {
        await open(`shop.php?mod=prodat&cpage=${cpage}`);
        target = await page.evaluate((names) => {
          for (const a of Array.from(document.querySelectorAll('a'))) {
            const t = (a.innerText || '').trim();
            const h = a.getAttribute('href') || '';
            if (!/mod=prod&/.test(h)) continue; // ссылка продажи конкретной вещи
            if (names.includes(t)) return { t, h };
          }
          return null;
        }, [...ALLOW.keys()].filter((n) => (ALLOW.get(n) || 0) > 0));
        if (target) break;
      }
      if (!target) { console.log('больше нечего продавать из списка.'); break; }
      await open(new URL(target.h, page.url()).href);
      const confirm = await page.evaluate(() => {
        const a = Array.from(document.querySelectorAll('a')).find((x) => /^-?\s*Да$/i.test((x.innerText || '').trim()));
        return a ? a.getAttribute('href') : null;
      });
      if (!confirm) { console.log(`нет подтверждения «- Да» для ${target.t} - останавливаюсь.`); break; }
      await open(new URL(confirm, page.url()).href);
      sold += 1;
      ALLOW.set(target.t, (ALLOW.get(target.t) || 1) - 1);
      console.log(`продал: ${target.t} (осталось продать по этому названию: ${ALLOW.get(target.t)})`);
      if ([...ALLOW.values()].every((n) => n <= 0)) { console.log('лимиты по списку исчерпаны.'); break; }
    }
    await open('shop.php?mod=prodat');
    const after = await money();
    console.log(`продано ${sold} шт., денег ${before} -> ${after} (+${after - before}).`);
  } finally { await ctx.close(); }
})();
