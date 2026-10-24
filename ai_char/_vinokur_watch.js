// После «Начать аукцион»: что на доске, сколько семян, появляется ли «Перебить». Три раза в секунду.
const { chromium } = require('playwright');
const { getBodyText } = require('./module');
const fs = require('fs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clean = (t) => String(t||'').replace(/\s+/g,' ').trim();
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const click = async (src) => {
    const h = await page.evaluate((s) => {
      const r = new RegExp(s,'i');
      const a = Array.from(document.querySelectorAll('a')).find((x)=>r.test((x.innerText||'').trim()));
      return a ? a.getAttribute('href') : null;
    }, src).catch(()=>null);
    if (!h) return false;
    await page.goto(new URL(h,'http://lbast.ru/').href, { waitUntil:'domcontentloaded', timeout:60000 });
    await sleep(250); return true;
  };
  await page.goto('http://lbast.ru/location.php', { waitUntil:'domcontentloaded', timeout:60000 });
  await sleep(300);
  await click('^Городская ратуша$');
  await click('^Аукцион$');
  const t0 = Date.now();
  let last='', flood=0, step=333;
  while (Date.now()-t0 < 7*60*1000) {
    const t = clean(await getBodyText(page).catch(()=>''));
    if (!t || /слишком часто|подожд|флуд|превышен/i.test(t)) {
      flood++; step=Math.min(4000, step*2);
      console.log(`[защита от частых запросов ${flood}] -> пауза ${step} мс | ${t.slice(0,120)}`);
      if (flood>=5) { console.log('пять подряд - сбавляю совсем'); step=4000; }
    }
    const vin = (t.match(/Винокур[^.]*?(?:сек|мин|дн|занято)\.?/)||[])[0]||'';
    const seeds = (t.match(/Семян оливкового дерева:\s*(\d+)/)||[])[1];
    const links = await page.$$eval('a',(as)=>as.map(a=>(a.innerText||'').trim()).filter(Boolean)).catch(()=>[]);
    const act = links.filter(x=>!/^(Обновить|Чат|В игру|Вернуться)$/.test(x));
    const sig = `${vin}|${seeds}|${act.join(',')}`;
    if (sig!==last) {
      last=sig;
      console.log(`[${new Date().toLocaleTimeString('ru-RU')}] ${vin} | семян ${seeds} | ${act.join(' | ')||'-'}`);
      try { fs.appendFileSync('auction_observe.jsonl', JSON.stringify({ts:new Date().toISOString(),prof:'Винокур',label:'торги',vin,seeds,links:act})+'\n'); } catch(e){}
    }
    if (/завершен|завершён|победит/i.test(t)) { console.log('ИТОГ: ' + t.slice(0,300)); break; }
    await page.reload({ waitUntil:'domcontentloaded', timeout:30000 }).catch(()=>{});
    await sleep(step);
  }
  await ctx.close();
})();
