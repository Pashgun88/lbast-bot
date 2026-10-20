// Эликсиры каменного голема - излишки в клановый магазин.
// Паша, 20.10.2026: «по поводу эликсира каменного голема, оставляй у себя 2, остальное сдавай в
// клановый магазин, как рыбу и черепа». У себя держим ровно KEEP штук - это запас под просьбы
// «нужен голем» (lib/golem.js), их тратить нельзя.
//
// Механика та же, что у черепов (lib/skulls.js): сумка открывается с подставленным ником казны
// (inv.php?lgn=...), «Передать» -> форма kol/price/cmnp. Цена в форме - ОБЩАЯ за пачку.
// Успех проверяем ПО ИГРЕ (перечитываем сумку), а не по тексту ответа - урок 09.10.2026.
//
// Цена: 40 дин за штуку - это цена самой вещи в игре. Своего числа не придумываю: Паша назовёт -
// поправлю через AI_GOLEM_ELIXIR_PRICE.
//
// Срок «раз в 2 дня» и порог «не меньше 2 штук излишка» - из того же урока с черепами: мелкие
// посылки по одной штуке Паша просил не делать. Варка даёт примерно один эликсир в сутки, значит
// посылка выходит из двух штук.

module.exports = { sendGolemElixirsIfDue };

const { S, persistDailyQuestState } = require('./state');
const { getBodyText, pause } = require('./core');

const NICK = process.env.AI_CLAN_SHOP_NICK || process.env.AI_SKULL_NICK || 'Bogi_vojny';
const PRICE_PER_ITEM = Number(process.env.AI_GOLEM_ELIXIR_PRICE || 40);
const KEEP = Number(process.env.AI_GOLEM_ELIXIR_KEEP || 2);
const MIN_SURPLUS = Number(process.env.AI_GOLEM_ELIXIR_MIN || 2);
const EVERY_MS = 2 * 24 * 60 * 60 * 1000;
const RETRY_MS = 60 * 60 * 1000;
const NAME_RE = /^эликсир каменного голема$/i;

// 20.10.2026, поправка Паши: «в клан магазин только то что принимает, рыбу в лавку боевых
// ресурсов». Значит привычку сдавать эликсиры нельзя включать, пока не известно, берёт ли их
// клановый магазин: первые две штуки уже предложены казне по 40 - по её ответу и узнаем.
// Пока ответа нет, шаг молчит (включается AI_GOLEM_ELIXIR_HANDIN=1).
const HANDIN_ENABLED = process.env.AI_GOLEM_ELIXIR_HANDIN === '1';

// Эликсир лежит на второй странице сумки, поэтому обе и смотрим.
const BAG_PAGES = [`inv.php?lgn=${NICK}`, `inv.php?lgn=${NICK}&cpage=2`, `inv.php?lgn=${NICK}&cpage=3`];

// Строки эликсира: сколько штук и ссылка «Передать». Число печатается отдельной ссылкой, а у
// одиночной вещи его нет вовсе - тогда штука одна.
async function readStacks(page) {
  const found = [];
  for (const url of BAG_PAGES) {
    const ok = await page.goto(`http://lbast.ru/${url}`, { waitUntil: 'domcontentloaded', timeout: 60000 })
      .then(() => true).catch(() => false);
    if (!ok) continue;
    if (/Восстановите здоровье/i.test(await getBodyText(page).catch(() => ''))) return { stacks: [], blocked: true };
    const rows = await page.evaluate((src) => {
      const re = new RegExp(src, 'i');
      const all = Array.from(document.querySelectorAll('a'));
      const res = [];
      for (let i = 0; i < all.length; i++) {
        if (!re.test((all[i].textContent || '').trim())) continue;
        let count = null;
        let pered = null;
        for (let k = i + 1; k < Math.min(i + 6, all.length); k++) {
          const t = (all[k].textContent || '').trim();
          if (/^\d+$/.test(t) && count === null) count = Number(t);
          if (t === 'Передать' && !pered) pered = all[k].getAttribute('href');
        }
        if (pered) res.push({ count: count || 1, pered });
      }
      return res;
    }, NAME_RE.source).catch(() => []);
    for (const r of rows) if (!found.some((f) => f.pered === r.pered)) found.push(r);
  }
  return { stacks: found, blocked: false };
}

async function sendOne(page, stack, qty) {
  const total = qty * PRICE_PER_ITEM;
  await page.goto(new URL(stack.pered, 'http://lbast.ru/').href, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.locator('input[name="kol"]').fill(String(qty));
  await page.locator('input[name="price"]').fill(String(total));
  await page.locator('input[name="cmnp"]').fill(`эликсиры каменного голема в клановый магазин, ${PRICE_PER_ITEM} за штуку`).catch(() => {});
  await Promise.all([
    page.waitForLoadState('domcontentloaded'),
    page.locator('input[type="submit"]').first().click(),
  ]);
  await pause(page, 500, 900);
  return total;
}

async function sendGolemElixirsIfDue(page) {
  if (!HANDIN_ENABLED) return false; // ждём слова Паши, берёт ли клановый магазин эликсиры
  const now = Date.now();
  if (now - (S.golemElixirSentAt || 0) < EVERY_MS) return false;
  if (now - (S.golemElixirTriedAt || 0) < RETRY_MS) return false;
  S.golemElixirTriedAt = now;
  persistDailyQuestState();

  const { stacks, blocked } = await readStacks(page);
  if (blocked) return false;
  const have = stacks.reduce((a, s) => a + s.count, 0);
  const surplus = have - KEEP;
  if (surplus < MIN_SURPLUS) {
    if (now - (S.golemElixirSmallLoggedAt || 0) > 24 * 60 * 60 * 1000) {
      S.golemElixirSmallLoggedAt = now;
      persistDailyQuestState();
      console.log(`Эликсиры голема: в сумке ${have}, себе держим ${KEEP}, излишек ${Math.max(0, surplus)} - меньше ${MIN_SURPLUS}, копим.`);
    }
    return false;
  }

  let left = surplus;
  let sent = 0;
  let money = 0;
  for (const stack of stacks) {
    if (left <= 0) break;
    const qty = Math.min(stack.count, left);
    money += await sendOne(page, stack, qty);
    sent += qty;
    left -= qty;
  }

  // Истина - игра: перечитываем сумку и смотрим, сколько осталось на руках.
  const after = (await readStacks(page)).stacks.reduce((a, s) => a + s.count, 0);
  if (after <= KEEP) {
    S.golemElixirSentAt = Date.now();
    persistDailyQuestState();
    console.log(`Эликсиры голема: сдал ${sent} шт в клановый магазин (${NICK}) за ${money} дин, по ${PRICE_PER_ITEM}; себе оставил ${after}.`);
    return true;
  }
  console.log(`Эликсиры голема: было ${have}, сдал ${sent}, на руках ${after} (держим ${KEEP}) - попробую через час.`);
  return sent > 0;
}
