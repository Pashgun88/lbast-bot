// Только чтение: где перерабатывать травы в зелья/эликсиры.
const { chromium } = require('playwright');
const m = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = [];
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const open = async (u, w = 800) => { await page.goto(new URL(u, 'http://lbast.ru/').href, { waitUntil: 'domcontentloaded', timeout: 60000 }); await sleep(w); };
  const txt = async () => (await m.getBodyText(page).catch(() => '')).replace(/\s+/g, ' ');

  // 1. Поиск по карте - только через форму
  const search = async (w) => {
    await page.goto('http://lbast.ru/map.php?mv=0&go=search#searchbar', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await sleep(500);
    const inp = await page.$('input[name="look"]');
    if (!inp) { out.push('нет поля look'); return; }
    await inp.fill(w);
    await inp.press('Enter');
    await sleep(1200);
    const t = (await m.getBodyText(page).catch(() => '')).replace(/[ \t]+/g, ' ');
    const body = (t.split('Замки NPC Все').pop() || '').split('1. Введите')[0].replace(/\s+/g, ' ').trim();
    out.push(`[КАРТА ${w}] ` + (body.slice(0, 900) || '-'));
  };
  for (const w of ['алхим', 'травн', 'зель', 'эликсир', 'гильди', 'лаборат', 'котел', 'ведьм']) await search(w);

  // 2. Дом: какие станки есть и какие продаются
  await open('dom.php?mod=myhouses');
  out.push(`\n===== МОИ ДОМА =====\n${(await txt()).slice(0, 900)}`);
  const hl = await page.evaluate(() => Array.from(document.querySelectorAll('a')).map((a) => `${(a.innerText || '').trim()} -> ${a.getAttribute('href') || ''}`).filter((s) => /dom_id|dom\.php/.test(s)));
  out.push(`ССЫЛКИ: ${hl.join(' | ').slice(0, 900)}`);
  const idm = hl.join(' ').match(/dom_id=(\d+)/);
  if (idm) {
    await open(`dom.php?mod=myhouses&dom_id=${idm[1]}&flag=house_items`);
    out.push(`\n===== ВЕЩИ В ДОМЕ ${idm[1]} =====\n${(await txt()).slice(0, 2500)}`);
  }

  // 3. Инвентарь: травы и что с ними можно сделать
  for (const u of ['inv.php', 'inv.php?cpage=2', 'inv.php?cpage=3']) {
    await open(u);
    const rows = await page.evaluate(() => {
      const as = Array.from(document.querySelectorAll('a'));
      const res = [];
      for (let i = 0; i < as.length; i++) {
        const t = (as[i].innerText || '').trim();
        if (!/краст|трави|пустолист|пререя|трава|корень|цвет|гриб/i.test(t)) continue;
        const h = as[i].getAttribute('href') || '';
        if (!/inv_id=|invid=/.test(h)) continue;
        const near = [];
        for (let j = i + 1; j < Math.min(i + 6, as.length); j++) {
          if (/inv_id=|invid=/.test(as[j].getAttribute('href') || '')) break;
          const tt = (as[j].innerText || '').trim();
          if (tt) near.push(`${tt} -> ${as[j].getAttribute('href')}`);
        }
        res.push(`${t} | ${h} :: ${near.join(' ; ')}`);
      }
      return res;
    });
    if (rows.length) out.push(`\n===== ${u} ТРАВЫ =====\n${rows.join('\n')}`);
  }
  require('fs').writeFileSync(process.argv[2], out.join('\n'), 'utf8');
  await ctx.close();
})().catch((e) => { require('fs').writeFileSync(process.argv[2], `ОШИБКА: ${e.stack}\n\n${out.join('\n')}`, 'utf8'); process.exit(1); });
