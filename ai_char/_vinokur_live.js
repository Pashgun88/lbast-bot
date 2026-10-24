// Живые торги Винокура: спам в доску событий + наблюдение + ставка через «Начать аукцион».
const { chromium } = require('playwright');
const { getBodyText } = require('./module');
const fs = require('fs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clean = (t) => String(t||'').replace(/\s+/g,' ').trim();
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  // 1) СПАМ про Винокура - Паша просил сейчас
  const TEXT = 'Сейчас идёт аукцион Винокура в Городе Мастеров, ратуша';
  await page.goto('http://lbast.ru/letters.php?mod=clan_spam&go=create', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(500);
  if (await page.locator('input[name="mess"]').count()) {
    await page.locator('input[name="mess"]').fill(TEXT);
    const from = await page.$eval('select[name="from_lev"]', (s) => s.options[0].value);
    const to = await page.$eval('select[name="to_lev"]', (s) => s.options[s.options.length-1].value);
    await page.selectOption('select[name="from_lev"]', from);
    await page.selectOption('select[name="to_lev"]', to);
    await Promise.all([page.waitForLoadState('domcontentloaded'), page.locator('input[type="submit"]').first().click()]);
    await sleep(600);
    await page.goto('http://lbast.ru/letters.php?mod=clan_spam', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(500);
    const board = clean(await getBodyText(page).catch(()=>''));
    console.log('СПАМ: ' + (board.includes(TEXT.slice(0,30)) ? 'на доске' : 'НЕ НАШЁЛ на доске'));
  } else console.log('СПАМ: формы нет');

  // 2) до ратуши
  const click = async (re) => {
    const h = await page.evaluate((src) => {
      const r = new RegExp(src,'i');
      const a = Array.from(document.querySelectorAll('a')).find((x)=>r.test((x.innerText||'').trim()));
      return a ? a.getAttribute('href') : null;
    }, re.source).catch(()=>null);
    if (!h) return false;
    await page.goto(new URL(h,'http://lbast.ru/').href, { waitUntil:'domcontentloaded', timeout:60000 });
    await sleep(400); return true;
  };
  await page.goto('http://lbast.ru/location.php', { waitUntil:'domcontentloaded', timeout:60000 });
  await sleep(400);
  let at = await click(/^Городская ратуша$/);
  if (!at) {
    await page.goto('http://lbast.ru/location.php?mod=fastway&lway=2', { waitUntil:'domcontentloaded', timeout:60000 });
    await sleep(7000);
    await page.goto('http://lbast.ru/location.php', { waitUntil:'domcontentloaded', timeout:60000 });
    await sleep(400);
    await click(/Северные ворота/); await click(/^Идти на север/);
    for (let i=0;i<5;i++){ const w=await page.evaluate(()=>Array.from(document.querySelectorAll('a')).some(a=>/^Идти на запад/i.test((a.innerText||'').trim()))); if(w)break; await click(/^Идти на север/);}
    for (let i=0;i<3;i++){ await click(/^Идти на запад/); if (await page.evaluate(()=>Array.from(document.querySelectorAll('a')).some(a=>/^Городская ратуша$/i.test((a.innerText||'').trim())))) break; }
    at = await click(/^Городская ратуша$/);
  }
  if (!at) { console.log('до ратуши не добрался'); await ctx.close(); return; }
  await click(/^Аукцион$/);
  const snap = async (label) => {
    const t = clean(await getBodyText(page).catch(()=>''));
    const links = await page.$$eval('a', (as)=>as.map(a=>(a.innerText||'').trim()).filter(Boolean)).catch(()=>[]);
    const forms = await page.$$eval('form', (fs2)=>fs2.map(f=>({action:f.getAttribute('action'),fields:Array.from(f.querySelectorAll('input,select,textarea')).map(i=>`${i.name||'-'}:${i.type||i.tagName}:${i.value||''}`)}))).catch(()=>[]);
    console.log(`\n[${label}] ${t.slice(0, 420)}`);
    console.log('  ссылки: ' + links.filter(x=>!/^(Обновить|Чат|В игру)$/.test(x)).join(' | '));
    if (forms.length) console.log('  ФОРМЫ: ' + JSON.stringify(forms));
    try { fs.appendFileSync('auction_observe.jsonl', JSON.stringify({ts:new Date().toISOString(),prof:'Винокур',label,text:t.slice(0,2000),links,forms})+'\n'); } catch(e){}
    return { t, links, forms };
  };
  let s = await snap('доска');
  // 3) ставка: «Начать аукцион»
  const bid = s.links.find((x)=>/начать аукцион|ставк|перебить/i.test(x));
  if (bid) {
    console.log(`\n>>> жму «${bid}»`);
    await click(new RegExp('начать аукцион|ставк|перебить','i'));
    s = await snap('после «' + bid + '»');
    if (s.forms.length) {
      const f = s.forms[0];
      for (const fld of f.fields) {
        const [name,type] = fld.split(':');
        if (name && name !== '-' && /^(text|number)$/i.test(type)) {
          await page.locator(`input[name="${name}"]`).first().fill('3').catch(()=>{});
          console.log(`  поле ${name} <- 3`);
        }
      }
      await Promise.all([page.waitForLoadState('domcontentloaded').catch(()=>{}), page.locator('input[type="submit"]').first().click().catch(()=>{})]);
      await sleep(800);
      await snap('ответ на ставку 3');
    }
  } else console.log('\nссылки входа в торги нет');
  await ctx.close();
})();
