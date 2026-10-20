// Разовый скрипт: раскидать свободные статы поровну и нанести татуировки на уворот.
// Паша, 20.10.2026: «распредели статы поровну насколько хватит к этому комплекту. и татуировки не забудь».
// Сначала проверяем СЕМАНТИКУ поля тату (всего или «нанести сейчас») одним шагом, и только потом
// ставим остаток - вслепую все 11 не тратим.
const { chromium } = require('playwright');
const { getBodyText } = require('./module');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BASE = 'http://lbast.ru/';

async function readForm(page, url, marker) {
  await page.goto(BASE + url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(700);
  const t = (await getBodyText(page).catch(() => '')).replace(/[ \t]+/g, ' ');
  const avail = Number((t.match(new RegExp(marker + String.raw`[:\s ]*(\d+)`)) || [])[1] ?? NaN);
  const fields = await page.$$eval('form input[type=text]', (is) => is.map((i) => ({ n: i.name, v: i.value })));
  const action = await page.$eval('form', (f) => f.getAttribute('action'));
  return { avail, fields, action };
}

async function submitForm(page, action, values) {
  await page.evaluate(({ action, values }) => {
    const f = Array.from(document.querySelectorAll('form')).find((x) => (x.getAttribute('action') || '') === action);
    for (const [n, v] of Object.entries(values)) {
      const i = f.querySelector(`input[name="${n}"]`);
      if (i) i.value = String(v);
    }
    f.submit();
  }, { action, values });
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await sleep(1200);
}

(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const { readCombatStats } = require('./lib/lease');
  const formatStats = (s) => `крит ${s.krit}, уворот ${s.uvorot}, броня ${s.armor}, HP max ${s.hpMax}`;
  console.log('мф ДО: ' + formatStats(await readCombatStats(page)));

  // --- СТАТЫ: поровну по силе/интуиции/ловкости/выносливости, сколько хватит ---
  let st = await readForm(page, 'pers.php?mod=stats', 'Доступно статов');
  console.log('статы сейчас: ' + st.fields.map((f) => `${f.n}=${f.v}`).join(' ') + `, свободно ${st.avail}`);
  const order = ['s1', 's2', 's3', 's4']; // сила, интуиция, ловкость, выносливость - те же четыре, что советует игра
  const vals = Object.fromEntries(st.fields.map((f) => [f.n, Number(f.v)]));
  let left = st.avail;
  while (left > 0) {
    const before = left;
    for (const k of order) { if (left <= 0) break; vals[k] += 1; left -= 1; }
    if (left === before) break;
  }
  console.log('ставлю статы: ' + Object.entries(vals).map(([k, v]) => `${k}=${v}`).join(' '));
  await submitForm(page, st.action, vals);
  st = await readForm(page, 'pers.php?mod=stats', 'Доступно статов');
  console.log('после: ' + st.fields.map((f) => `${f.n}=${f.v}`).join(' ') + `, свободно ${st.avail}`);

  // --- ТАТУ: проверка семантики поля ---
  let tt = await readForm(page, 'pers.php?mod=tatu', 'Доступно тату');
  const cur = Object.fromEntries(tt.fields.map((f) => [f.n, Number(f.v)]));
  console.log(`тату сейчас: ${tt.fields.map((f) => `${f.n}=${f.v}`).join(' ')}, доступно ${tt.avail}`);
  const availBefore = tt.avail;
  const v4 = cur.s4;
  await submitForm(page, tt.action, { ...cur, s4: v4 + 1 });
  tt = await readForm(page, 'pers.php?mod=tatu', 'Доступно тату');
  const drop = availBefore - tt.avail;
  console.log(`пробный шаг: s4 ставил ${v4 + 1}, доступно ${availBefore} -> ${tt.avail} (минус ${drop}); поля теперь ${tt.fields.map((f) => `${f.n}=${f.v}`).join(' ')}`);
  const cur2 = Object.fromEntries(tt.fields.map((f) => [f.n, Number(f.v)]));
  if (tt.avail > 0) {
    const target = drop === 1 ? cur2.s4 + tt.avail : tt.avail; // «всего» или «нанести сейчас»
    console.log(`семантика: ${drop === 1 ? 'поле = всего нанесено' : 'поле = нанести сейчас'}; ставлю s4=${target} (остаток ${tt.avail} в Огненный кинжал)`);
    await submitForm(page, tt.action, { ...cur2, s4: target });
    tt = await readForm(page, 'pers.php?mod=tatu', 'Доступно тату');
    console.log(`итог тату: ${tt.fields.map((f) => `${f.n}=${f.v}`).join(' ')}, доступно ${tt.avail}`);
  }
  console.log('мф ПОСЛЕ: ' + formatStats(await readCombatStats(page)));
  await ctx.close();
})();
