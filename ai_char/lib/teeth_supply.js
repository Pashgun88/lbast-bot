// Зубы горгульи: сначала варка, остаток - Ханку по 250.
//
// Паша в клановом зале 24.10.2026: «Кинь Ханку зубы, у тебя много должно быть» → «По 250 кидай» →
// и поправка: «ты сначала сам свари все что можешь а остаток ханку кинь по 250 каждый».
//
// Зуб горгульи - половина рецепта «Эликсира каменного голема» (вторая половина - лист змеевика,
// проверено в гильдии 23.10.2026). Листьев всегда меньше, поэтому они и есть ограничитель: держим
// на руках СТОЛЬКО ЖЕ зубов, сколько листьев, а всё сверх этого - Ханку. Так варка ничего не
// теряет, а зубы не копятся мёртвым грузом (23.10 их лежало 23 штуки).
//
// Передача - та же механика, что у черепов (lib/skulls.js): сумка открывается с подставленным
// ником (inv.php?lgn=Hank), ссылка «Передать», форма kol/price/cmnp, и цена в форме - ОБЩАЯ сумма
// за пачку, а не за штуку (на этом я обжигался 21.09.2026). Сделку принимает человек на той
// стороне; пока не принял, зубы висят предложением и их можно отозвать.

module.exports = { sendGargoyleTeethIfDue };

const { S, persistDailyQuestState } = require('./state');
const { getBodyText, pause } = require('./core');

const NICK = process.env.AI_TEETH_NICK || 'Hank';
const PRICE_PER_ITEM = Number(process.env.AI_TEETH_PRICE || 250);
const MIN_BATCH = Number(process.env.AI_TEETH_MIN || 5);
const EVERY_MS = 2 * 24 * 60 * 60 * 1000;
const RETRY_MS = 60 * 60 * 1000;
const TOOTH_RE = /^Зуб Горгульи$/i;
const LEAF_RE = /^Лист Змеевика$/i;

const BAG_PAGES = (lgn) => [`inv.php?lgn=${lgn}`, `inv.php?lgn=${lgn}&cpage=2`, `inv.php?lgn=${lgn}&cpage=3`];

// Строка предмета: сколько штук и ссылка «Передать». Число печатается отдельной ссылкой, у
// одиночной вещи его нет вовсе - тогда штука одна.
async function readRow(page, re) {
  for (const u of BAG_PAGES(NICK)) {
    const ok = await page.goto(`http://lbast.ru/${u}`, { waitUntil: 'domcontentloaded', timeout: 60000 })
      .then(() => true).catch(() => false);
    if (!ok) continue;
    if (/Восстановите здоровье/i.test(await getBodyText(page).catch(() => ''))) return null;
    const row = await page.evaluate((src) => {
      const r = new RegExp(src, 'i');
      const all = Array.from(document.querySelectorAll('a'));
      for (let i = 0; i < all.length; i++) {
        if (!r.test((all[i].textContent || '').trim())) continue;
        let count = null;
        let pered = null;
        for (let k = i + 1; k < Math.min(i + 6, all.length); k++) {
          const t = (all[k].textContent || '').trim();
          if (/^\d+$/.test(t) && count === null) count = Number(t);
          if (t === 'Передать' && !pered) pered = all[k].getAttribute('href');
        }
        return { count: count || 1, pered };
      }
      return null;
    }, re.source).catch(() => null);
    if (row) return row;
  }
  return null;
}

async function sendGargoyleTeethIfDue(page) {
  const now = Date.now();
  if (now - (S.teethSentAt || 0) < EVERY_MS) return false;
  if (now - (S.teethTriedAt || 0) < RETRY_MS) return false;
  S.teethTriedAt = now;
  persistDailyQuestState();

  const teeth = await readRow(page, TOOTH_RE);
  if (!teeth) return false;
  const leaves = await readRow(page, LEAF_RE);
  const keep = leaves ? leaves.count : 0;  // под каждый лист змеевика - свой зуб, это варка голема
  const surplus = teeth.count - keep;
  if (surplus < MIN_BATCH) {
    if (S.teethSmallLoggedDay !== new Date().toLocaleDateString('ru-RU')) {
      S.teethSmallLoggedDay = new Date().toLocaleDateString('ru-RU');
      persistDailyQuestState();
      console.log(`Зубы горгульи: в сумке ${teeth.count}, под варку держу ${keep} (столько же, сколько листьев змеевика), остаток ${Math.max(0, surplus)} - меньше ${MIN_BATCH}, копим.`);
    }
    return false;
  }

  const total = surplus * PRICE_PER_ITEM;
  await page.goto(new URL(teeth.pered, 'http://lbast.ru/').href, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.locator('input[name="kol"]').fill(String(surplus));
  await page.locator('input[name="price"]').fill(String(total));
  await page.locator('input[name="cmnp"]').fill(`зубы горгульи, ${PRICE_PER_ITEM} за штуку`).catch(() => {});
  await Promise.all([
    page.waitForLoadState('domcontentloaded'),
    page.locator('input[type="submit"]').first().click(),
  ]);
  await pause(page, 500, 900);

  // Истина - игра: перечитываем сумку и смотрим, сколько осталось на руках.
  const after = await readRow(page, TOOTH_RE);
  const left = after ? after.count : 0;
  if (left <= keep) {
    S.teethSentAt = Date.now();
    persistDailyQuestState();
    console.log(`Зубы горгульи: отправил ${surplus} шт ${NICK} за ${total} дин, по ${PRICE_PER_ITEM}; на руках оставил ${left} под варку.`);
    return true;
  }
  console.log(`Зубы горгульи: было ${teeth.count}, отправлял ${surplus}, на руках ${left} - попробую через час.`);
  return false;
}
