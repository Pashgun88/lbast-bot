// Разово: перекинуть статы под полный комплект Ордо и одеться (Паша 23.09.2026:
// «перекинь статы чтобы одеть все ордо», «Перекидывай статы и одевай»).
//
// Требования, снятые с описаний вещей (23.09.2026):
//   посох  С12 И18 Л10 В6 У8      шлем   С8  И8  Л8  В6 У8
//   кираса С10 И18 Л12 В6         кольцо С10 И6  Л6
//   нож    С8  И25 Л2  В2 У8      сапоги С13 И26 Л12 В10
//   плащ   С10 И10 Л10 В10 У5     браслет В2 У4    брюки В2 У2   руна В2 У2
// Максимумы: Сила 13, Инта 26, Ловка 12, Вынос 10, Удача 8 - остальное в Ловкость.
// Щит ухода (Л26) и Сапоги защиты (Л26) при этом надеть нельзя: на Инту 26 и Ловку 26
// одновременно не хватает очков (нужно 83, есть 81). Сапоги заменяются ордовскими, щит
// остаётся в сумке - об этом доложить Паше.
const { chromium } = require('playwright');
const m = require('../module');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// st=1 Сила, 2 Интуиция, 3 Ловкость, 4 Выносливость, 5 Удача, 6 Интеллект
const TARGET = { 1: 13, 2: 26, 4: 10, 5: 8 }; // Ловкость (3) - весь остаток
const DUMP = 3;
const WEAR = [
  'Боевой посох Ордо экзекуторс',
  'Кираса ордо экзекуторс',
  'Шлем ордо экзекуторс (ожег)',
  'Кольцо ордо экзекуторс',
  'Боевой нож ордо экзекуторс (ожег)',
  'Сапоги ордо экзекуторс',
  'Кожаные брюки',
  'Браслет удачи (перегар)',
  'Плащ охотника',
  'Руна силы заката (7)',
  'Жертвенный кинжал (могильный холод)',
];

(async () => {
  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const open = async (url, wait = 2000) => {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(wait);
  };
  const readStats = async () => {
    await open('http://lbast.ru/pers.php?mod=stats');
    const vals = await page.evaluate(() => {
      const o = {};
      for (const i of Array.from(document.querySelectorAll('input'))) {
        const n = i.getAttribute('name');
        if (/^s[1-6]$/.test(n || '')) o[n.slice(1)] = Number(i.value || 0);
      }
      return o;
    });
    const t = await m.getBodyText(page);
    const free = Number((t.match(/Доступно статов:\s*(\d+)/) || [])[1] || 0);
    return { vals, free };
  };
  try {
    let st = await readStats();
    const total = Object.values(st.vals).reduce((a, b) => a + b, 0) + st.free;
    console.log('До сброса:', JSON.stringify(st), 'всего очков:', total);

    // Повторный запуск (первый раз браузер упал на 20-м клике): если статы уже сброшены и есть
    // свободные очки - сразу к раскидке, без второго сброса за 50 дин.
    const alreadyReset = st.free > 0;
    if (!alreadyReset) {
    // 1. Снять всё - иначе сброс отказывает («При понижении статов необходимо сначала снять экипировку»).
    await open('http://lbast.ru/inv.php?mod=outfit');
    const offAll = await page.evaluate(() => {
      const a = Array.from(document.querySelectorAll('a')).find((x) => /Снять все/i.test((x.innerText || '').trim()));
      return a ? a.getAttribute('href') : null;
    });
    if (!offAll) throw new Error('не нашёл «Снять все»');
    await open(new URL(offAll, page.url()).href, 3000);
    console.log('Снял всё.');

    // 2. Сброс: две ссылки подтверждения, настоящая - с &ok=1.
    await open('http://lbast.ru/pers.php?mod=stats&go=cleanStats', 2500);
    console.log('подтверждение сброса:', (await m.getBodyText(page)).replace(/\s+/g, ' ').slice(0, 160));
    await open('http://lbast.ru/pers.php?mod=stats&go=cleanStats&ok=1', 3000);
    st = await readStats();
    console.log('После сброса:', JSON.stringify(st));
    if (st.free === 0) throw new Error('сброс не сработал - свободных статов 0');
    } else {
      console.log('Статы уже сброшены, свободных очков', st.free, '- продолжаю раскидку.');
    }

    // 3. Раскидать: сначала минимумы под вещи, остаток - в Ловкость. Клики по одному,
    // пауза 500 мс - сервер банит за 10 кликов в 2 секунды.
    const plan = [];
    for (const [stat, want] of Object.entries(TARGET)) {
      const need = want - (st.vals[stat] || 0);
      for (let i = 0; i < need; i++) plan.push(Number(stat));
    }
    const rest = st.free - plan.length;
    if (rest < 0) throw new Error(`очков не хватает: нужно ${plan.length}, есть ${st.free}`);
    for (let i = 0; i < rest; i++) plan.push(DUMP);
    console.log(`План: ${plan.length} кликов (в Ловкость ${rest}).`);
    for (let k = 0; k < plan.length; k++) {
      const url = `http://lbast.ru/pers.php?mod=stats&go=setOneStat&st=${plan[k]}`;
      let ok = false;
      for (let attempt = 1; attempt <= 4 && !ok; attempt++) {
        try {
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
          ok = true;
        } catch (e) {
          // ERR_INSUFFICIENT_RESOURCES на длинной серии переходов - подождать и повторить
          console.log(`клик ${k + 1}/${plan.length} (st=${plan[k]}) сорвался: ${e.message.slice(0, 60)} - повтор ${attempt}`);
          await sleep(4000);
        }
      }
      if (!ok) throw new Error(`не смог поставить стат ${plan[k]} на шаге ${k + 1}`);
      await sleep(500);
    }
    st = await readStats();
    console.log('После раскидки:', JSON.stringify(st));

    // 4. Одеться. Название вещи стоит ПЕРЕД своей ссылкой «Экипировать» (порядок документа).
    for (const name of WEAR) {
      let done = false;
      for (const url of ['http://lbast.ru/inv.php?invMod=2', 'http://lbast.ru/inv.php?invMod=2&cpage=2',
        'http://lbast.ru/inv.php?invMod=3', 'http://lbast.ru/inv.php?invMod=3&cpage=2']) {
        await open(url, 2200);
        const h = await page.evaluate((want) => {
          const all = Array.from(document.querySelectorAll('a'));
          for (let i = 1; i < all.length; i++) {
            if (!/Экипировать/i.test((all[i].innerText || '').trim())) continue;
            for (let j = i - 1; j >= 0 && j >= i - 3; j--) {
              if ((all[j].innerText || '').trim() === want) return all[i].getAttribute('href');
            }
          }
          return null;
        }, name);
        if (!h) continue;
        await open(new URL(h, page.url()).href, 2200);
        const res = (await m.getBodyText(page)).replace(/\s+/g, ' ');
        const bad = /нехватает|не хватает|нельзя|Требования/i.test(res) && !/Вы экипировали/i.test(res);
        console.log(`${bad ? 'НЕ НАДЕЛ' : 'надел'}: ${name} -> ${res.slice(0, 180)}`);
        done = true;
        break;
      }
      if (!done) console.log(`не нашёл в сумке: ${name}`);
    }

    await open('http://lbast.ru/inv.php?mod=outfit', 2000);
    console.log('\nЭКИПИРОВКА:\n' + (await m.getBodyText(page)).replace(/\n\s*\n+/g, '\n').slice(0, 1200));
    await open('http://lbast.ru/pers.php', 2000);
    const p = (await m.getBodyText(page)).replace(/\n\s*\n+/g, '\n');
    console.log('\nАНКЕТА:\n' + p.slice(0, 1100));
  } finally { await ctx.close(); }
})();
