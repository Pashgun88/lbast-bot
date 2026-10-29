// «Эликсир исцеления (HP+480)» - Паше (Tsunami) по 35 за штуку.
//
// Паша, 29.10.2026: «на 480 не трогай, это на продажу. Можешь их мне кинуть по 35 каждый».
// Надеть их мы всё равно не можем - игра отвечает «Ваших статов нехватает» (замер того же дня),
// так что в сумке они только занимают место. Варятся из молодицы в гильдии травников, поэтому
// передача не разовая: что накопилось за сутки - то и уходит.
//
// Механика та же, что у зубов (lib/teeth_supply.js) и черепов: сумка открывается с подставленным
// ником (inv.php?lgn=Tsunami), ссылка «Передать», форма kol/price/cmnp. ЦЕНА В ФОРМЕ - ОБЩАЯ
// СУММА за пачку, а не за штуку. Пока человек не принял, вещи висят предложением.

module.exports = { sendHealingElixirsIfDue };

const { S, persistDailyQuestState } = require('./state');
const { getBodyText, pause } = require('./core');

const NICK = process.env.AI_ELIXIR_NICK || 'Tsunami';
const PRICE_PER_ITEM = Number(process.env.AI_ELIXIR_PRICE || 35);
const MIN_BATCH = Number(process.env.AI_ELIXIR_MIN || 1);
const EVERY_MS = 24 * 60 * 60 * 1000;
const RETRY_MS = 60 * 60 * 1000;
const ELIXIR_RE = /^Эликсир исцеления/i;

const BAG_PAGES = (lgn) => [`inv.php?lgn=${lgn}`, `inv.php?lgn=${lgn}&cpage=2`, `inv.php?lgn=${lgn}&cpage=3`];

// Строка предмета: сколько штук и ссылка «Передать». Число печатается отдельной ссылкой,
// у одиночной вещи его нет вовсе - тогда штука одна.
async function readRow(page) {
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
    }, ELIXIR_RE.source).catch(() => null);
    if (row && row.pered) return row;
  }
  return null;
}

async function sendHealingElixirsIfDue(page, { force = false } = {}) {
  const now = Date.now();
  if (!force && now - (S.healElixirSentAt || 0) < EVERY_MS) return false;
  if (!force && now - (S.healElixirTriedAt || 0) < RETRY_MS) return false;
  S.healElixirTriedAt = now;
  persistDailyQuestState();

  const row = await readRow(page);
  if (!row) return false;
  if (row.count < MIN_BATCH) return false;

  const total = row.count * PRICE_PER_ITEM;
  await page.goto(new URL(row.pered, 'http://lbast.ru/').href, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.locator('input[name="kol"]').fill(String(row.count));
  await page.locator('input[name="price"]').fill(String(total));
  await page.locator('input[name="cmnp"]').fill(`эликсиры исцеления, ${PRICE_PER_ITEM} за штуку`).catch(() => {});
  await Promise.all([
    page.waitForLoadState('domcontentloaded'),
    page.locator('input[type="submit"]').first().click(),
  ]);
  await pause(page, 500, 900);

  // Истина - игра: перечитываем сумку и смотрим, сколько осталось на руках.
  const after = await readRow(page);
  const left = after ? after.count : 0;
  if (left === 0) {
    S.healElixirSentAt = Date.now();
    persistDailyQuestState();
    console.log(`Эликсиры исцеления: отправил ${row.count} шт ${NICK} за ${total} дин, по ${PRICE_PER_ITEM}.`);
    return true;
  }
  console.log(`Эликсиры исцеления: было ${row.count}, на руках осталось ${left} - попробую через час.`);
  return false;
}
