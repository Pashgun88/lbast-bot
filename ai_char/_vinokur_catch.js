// Ловим момент: отсчёт Винокура кончается - ждём ссылку «Начать аукцион», жмём, смотрим форму.
const { chromium } = require('playwright');
const { getBodyText } = require('./module');
const fs = require('fs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clean = (t) => String(t||'').replace(/\s+/g,' ').trim();
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  await page.goto('http://lbast.ru/location.php', { waitUntil:'domcontentloaded', timeout:60000 });
  await sleep(300);
  const click = async (re) => {
    const h = await page.evaluate((src) => {
      const r = new RegExp(src,'i');
      const a = Array.from(document.querySelectorAll('a')).find((x)=>r.test((x.innerText||'').trim()));
      return a ? a.getAttribute('href') : null;
    }, re.source).catch(()=>null);
    if (!h) return false;
    await page.goto(new URL(h,'http://lbast.ru/').href, { waitUntil:'domcontentloaded', timeout:60000 });
    await sleep(250); return true;
  };
  if (!(await click(/^Городская ратуша$/))) { console.log('не в Городе Мастеров'); await ctx.close(); return; }
  await click(/^Аукцион$/);
  const log = (o) => { try { fs.appendFileSync('auction_observe.jsonl', JSON.stringify(o)+'\n'); } catch(e){} };
  const t0 = Date.now();
  let lastShown = '';
  while (Date.now() - t0 < 4 * 60 * 1000) {
    const t = clean(await getBodyText(page).catch(()=>''));
    const links = await page.$$eval('a', (as)=>as.map(a=>(a.innerText||'').trim()).filter(Boolean)).catch(()=>[]);
    const vin = (t.match(/Винокур[^.]*?(?:сек|мин|дн)\.?/) || [])[0] || '';
    if (vin !== lastShown) { lastShown = vin; console.log(`[${new Date().toLocaleTimeString('ru-RU')}] ${vin} | ссылки: ${links.filter(x=>!/^(Обновить|Чат|В игру|Вернуться)$/.test(x)).join(' | ') || '-'}`); }
    const start = links.find((x)=>/начать аукцион|ставк|перебить/i.test(x));
    if (start) {
      console.log(`\n>>> появилась «${start}» - жму`);
      await click(new RegExp('начать аукцион|ставк|перебить','i'));
      const after = clean(await getBodyText(page).catch(()=>''));
      const forms = await page.$$eval('form', (fs2)=>fs2.map(f=>({action:f.getAttribute('action'),fields:Array.from(f.querySelectorAll('input,select,textarea')).map(i=>`${i.name||'-'}:${i.type||i.tagName}:${i.value||''}`)}))).catch(()=>[]);
      const links2 = await page.$$eval('a', (as)=>as.map(a=>(a.innerText||'').trim()).filter(Boolean)).catch(()=>[]);
      console.log('ЭКРАН ТОРГОВ: ' + after.slice(0, 600));
      console.log('ссылки: ' + links2.join(' | '));
      console.log('ФОРМЫ: ' + JSON.stringify(forms));
      log({ ts:new Date().toISOString(), prof:'Винокур', label:'экран торгов', text:after.slice(0,2000), links:links2, forms });
      if (forms.length) {
        for (const fld of forms[0].fields) {
          const [name,type] = fld.split(':');
          if (name && name!=='-' && /^(text|number)$/i.test(type)) { await page.locator(`input[name="${name}"]`).first().fill('3').catch(()=>{}); console.log(`поле ${name} <- 3`); }
        }
        await Promise.all([page.waitForLoadState('domcontentloaded').catch(()=>{}), page.locator('input[type="submit"]').first().click().catch(()=>{})]);
        await sleep(800);
        const resp = clean(await getBodyText(page).catch(()=>''));
        console.log('ОТВЕТ НА СТАВКУ 3: ' + resp.slice(0, 500));
        log({ ts:new Date().toISOString(), prof:'Винокур', label:'ответ на ставку 3', text:resp.slice(0,2000) });
      }
      break;
    }
    await page.reload({ waitUntil:'domcontentloaded', timeout:30000 }).catch(()=>{});
    await sleep(1500);
  }
  await ctx.close();
})();
