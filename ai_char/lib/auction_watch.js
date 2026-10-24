// Аукционы Города Мастеров: напоминания Паше.
//
// Паша, 21.10.2026: «нужна разведка в городской ратуше - там пишут когда какой аукцион будет,
// каждый обновляется раз в неделю, шли по утрам напоминалки если какой то аукцион в текущий день.
// 2 раз утром в 8-9, второй за 3 часа и последний за 10 минут». И поправка про место: «нет не та
// ратуша. Твоя - на севере из стоуна (3-5 раз) до первого поворота на запад, там еще 3 шага на
// запад» - это ГОРОД МАСТЕРОВ, а не ратуша Стоунгарда (туда ходит работа гражданина).
//
// Дорога (пройдена вживую 21.10.2026): Стоунгард -> Северные ворота -> Идти на север -> север ->
// север (на третьем шаге появляется поворот на запад) -> запад, запад, запад -> Город Мастеров ->
// Городская ратуша.
//
// ВАЖНО, и на этом я обжёгся: 21.10.2026 я записал «ходить не нужно, страница открывается прямой
// ссылкой - проверено». Проверка была негодная: я стоял тогда В Городе Мастеров. Номер объекта в
// lbast ЛОКАЛЬНЫЙ - из любого другого места loc.php?obj=5116 отдаёт пустую страницу (тот же урок
// уже был с гильдией травников, obj=5134). Поэтому за доской ХОДИМ, и до 24.10.2026 ни одного
// напоминания не ушло: в журнале копилось «доска не разобралась».
//
// Как устроено (из «О городе», замер 21.10.2026): семь ремёсел, каждое занято игроком на неделю, у
// каждого в ратуше свой отсчёт («Винокур - BlackOpium еще 3 дн.»). Отсчёт кончился - по этому
// ремеслу идёт аукцион. Платят не динами, а СЕМЕНАМИ оливкового дерева: шаг не меньше 3 семян,
// ставка держится 6 минут, не перебили - аукцион закрыт. Семена падают в боях с шансом уровень/4,
// на руках больше 150 не держится, перебитая ставка семян не теряет.
// Ценз по уровню: Винокур 10, Травник 11, Аптекарь 12, Мэр города 13 (1000 дин в день и ничего не
// делает), Мясник 14, Кузнец 15, Перчаточник 16.
//
// Куда пишем: Паша, 21.10.2026 - «напоминания в клан зал шли». Значит не в Telegram, а строкой в
// клановый зал (room=12) через chat_outbox.json, как дозор за бунгало. Если в один день несколько
// аукционов, они собираются в ОДНУ строку: три сообщения подряд в зале - это спам, а не польза.
//
// Последнее напоминание - иначе. Паша, 21.10.2026: «последнее информирование за 10 минут - сделай
// через спам - письма - доска событий - дать спам. Там в поле текстовое вводишь и жмешь написать».
// Это letters.php?mod=clan_spam&go=create: поле mess, два списка уровней (from_lev по умолчанию 0,
// to_lev почему-то 4) и галка «либо своему уровню». Ставим весь диапазон, от первого значения до
// последнего, - за десять минут до торгов новость нужна всем, а не четвёртым уровням. Галку
// mylevel не трогаем: она сужает рассылку до своего уровня.
//
// Отсчёт игра печатает грубо, пока далеко («еще 3 дн.»), и точно, когда близко («еще 2 дн. 7 ч.
// 30 мин.»). Поэтому доску перечитываем раз в 2 часа: к самому дню аукциона время уже точное.

module.exports = { runAuctionRemindersIfDue, parseAuctionBoard, dueReminder };

const fs = require('fs');
const path = require('path');
const { S, persistDailyQuestState } = require('./state');
const { getBodyText, pause } = require('./core');

const OUTBOX_FILE = path.join(__dirname, '..', 'chat_outbox.json');
const CLAN_HALL_ROOM = 12;
const READ_EVERY_MS = 2 * 60 * 60 * 1000;
const MORNING_FROM = 8;
const MORNING_TO = 10;
const HOURS_3 = 3 * 60 * 60 * 1000;
const MIN_10 = 10 * 60 * 1000;

const PROFESSIONS = [
  { name: 'Винокур', level: 10, what: 'древний эль' },
  { name: 'Травник', level: 11, what: 'эликсир лечения кханту' },
  { name: 'Аптекарь', level: 12, what: 'эликсир лечения 900 hp' },
  { name: 'Мэр города', level: 13, what: '1000 дин в день' },
  { name: 'Мясник', level: 14, what: 'жареное мясо' },
  { name: 'Кузнец', level: 15, what: 'латные поножи' },
  { name: 'Перчаточник', level: 16, what: 'перчатки' },
];

// Спам на доску событий - рассылка всем уровням. Отчёт игры пишем в лог целиком: цену и возможный
// запрет «не чаще чем...» я ещё не видел, и узнать их можно только по живому ответу.
async function sendSpam(page, text) {
  await page.goto('http://lbast.ru/letters.php?mod=clan_spam&go=create', { waitUntil: 'domcontentloaded', timeout: 60000 });
  const hasForm = await page.locator('input[name="mess"]').count().catch(() => 0);
  if (!hasForm) { console.log('Спам: поля mess на странице нет - рассылка не ушла.'); return false; }
  await page.locator('input[name="mess"]').fill(text);
  const from = await page.$eval('select[name="from_lev"]', (s2) => s2.options[0].value).catch(() => null);
  const to = await page.$eval('select[name="to_lev"]', (s2) => s2.options[s2.options.length - 1].value).catch(() => null);
  if (from !== null) await page.selectOption('select[name="from_lev"]', from).catch(() => {});
  if (to !== null) await page.selectOption('select[name="to_lev"]', to).catch(() => {});
  await Promise.all([
    page.waitForLoadState('domcontentloaded'),
    page.locator('input[type="submit"]').first().click(),
  ]);
  const after = (await getBodyText(page).catch(() => '')).replace(/\s+/g, ' ');
  // Истина - игра: ищем свою строку на доске, а не верим ответу страницы.
  await page.goto('http://lbast.ru/letters.php?mod=clan_spam', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  const board = (await getBodyText(page).catch(() => '')).replace(/\s+/g, ' ');
  const landed = board.includes(text.slice(0, 40));
  console.log(`Спам: ${landed ? 'строка на доске' : 'на доске НЕ НАШЁЛ'}; уровни ${from}-${to}; ответ страницы: ${after.slice(0, 200)}`);
  return landed;
}

function appendOutbox(text) {
  let items = [];
  try { items = JSON.parse(fs.readFileSync(OUTBOX_FILE, 'utf8')); } catch (e) { /* файла нет */ }
  if (!Array.isArray(items)) items = [];
  items.push({ room: CLAN_HALL_ROOM, text });
  fs.writeFileSync(OUTBOX_FILE, JSON.stringify(items));
}

const dayKey = (t) => new Date(t).toLocaleDateString('ru-RU');
const hhmm = (t) => new Date(t).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

// Строки вида «Винокур - BlackOpium еще 3 дн.» или «... еще 2 дн. 7 ч. 30 мин.».
// Абсолютный срок считаем сразу: отсчёт в игре тикает, а записанная метка - нет.
function parseAuctionBoard(text, now = Date.now()) {
  const rows = [];
  const unknown = [];
  const seeds = Number((String(text).match(/Семян оливкового дерева:\s*(\d+)/i) || [])[1]);
  for (const raw of String(text || '').split('\n')) {
    const line = raw.replace(/\s+/g, ' ').trim();
    if (!line) continue;
    const prof = PROFESSIONS.find((p) => line.toLowerCase().startsWith(p.name.toLowerCase()));
    if (!prof) continue;
    const m = line.match(/ещ[её]\s*(?:(\d+)\s*дн)?\.?\s*(?:(\d+)\s*ч)?\.?\s*(?:(\d+)\s*мин)?/i);
    if (!m || (!m[1] && !m[2] && !m[3])) { unknown.push(line); continue; }
    const ms = (Number(m[1] || 0) * 24 * 60 + Number(m[2] || 0) * 60 + Number(m[3] || 0)) * 60 * 1000;
    const holder = (line.match(/-\s*(\S+)\s+ещ[её]/i) || [])[1] || '?';
    rows.push({ prof: prof.name, level: prof.level, what: prof.what, holder, endsAt: now + ms, coarse: !m[2] && !m[3] });
  }
  return { rows, unknown, seeds };
}

// Какое напоминание пора послать (или null). Отдельная функция - чтобы проверять тестом без игры:
// на часах ошибиться легче всего.
function dueReminder(endsAt, sentKinds, now = Date.now()) {
  const left = endsAt - now;
  if (left <= -MIN_10) return null;
  if (left <= MIN_10 && !sentKinds.includes('10м')) return { kind: '10м', text: 'через 10 минут' };
  if (left <= HOURS_3 && !sentKinds.includes('3ч')) return { kind: '3ч', text: 'через 3 часа' };
  const h = new Date(now).getHours();
  if (h >= MORNING_FROM && h < MORNING_TO && !sentKinds.includes('утро')) {
    return { kind: 'утро', text: `сегодня в ${hhmm(endsAt)}` };
  }
  return null;
}

// Дорога до доски: Стоунгард -> Северные ворота -> на север, пока не появится «Идти на запад»
// (это третья клетка) -> на запад три раза -> Город Мастеров -> Городская ратуша -> Аукцион.
// Если ссылка «Городская ратуша» видна на текущей локации, мы уже на месте и никуда не идём.
async function openBoard(page) {
  const click = async (re) => {
    const href = await page.evaluate((src) => {
      const r = new RegExp(src, 'i');
      const a = Array.from(document.querySelectorAll('a')).find((x) => r.test((x.innerText || '').trim()));
      return a ? a.getAttribute('href') : null;
    }, re.source).catch(() => null);
    if (!href) return false;
    await page.goto(new URL(href, 'http://lbast.ru/').href, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await pause(page, 400, 700);
    return true;
  };
  const atBoard = async () => {
    if (!(await click(/^Городская ратуша$/))) return false;
    if (!(await click(/^Аукцион$/))) return false;
    return true;
  };

  await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await pause(page, 300, 600);
  if (await atBoard()) return getBodyText(page).catch(() => '');

  // Не на месте - идём от Стоунгарда.
  await page.goto('http://lbast.ru/location.php?mod=fastway&lway=2', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 7000));
  await page.goto('http://lbast.ru/location.php', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await pause(page, 300, 600);
  if (!(await click(/Северные ворота/))) return '';
  if (!(await click(/^Идти на север/))) return '';
  for (let i = 0; i < 5; i += 1) {
    const hasWest = await page.evaluate(() => Array.from(document.querySelectorAll('a'))
      .some((a) => /^Идти на запад/i.test((a.innerText || '').trim()))).catch(() => false);
    if (hasWest) break;
    if (!(await click(/^Идти на север/))) return '';
  }
  for (let i = 0; i < 3; i += 1) {
    if (!(await click(/^Идти на запад/))) break;
    if (await atBoard()) return getBodyText(page).catch(() => '');
  }
  return (await atBoard()) ? getBodyText(page).catch(() => '') : '';
}

// Сверка с живой страницей: каждое «Ремесло в ЧЧ:ММ» должно найтись на доске с тем же временем
// (допуск 3 минуты - страница печатает отсчёт с округлением до минуты).
async function boardConfirms(page, parts) {
  const text = await openBoard(page);
  const live = parseAuctionBoard(text, Date.now()).rows;
  if (!live.length) return false;
  return parts.every((p) => {
    const [prof, time] = p.split(' в ');
    const row = live.find((r) => r.prof === prof.trim());
    if (!row) return false;
    const [h, m] = time.trim().split(':').map(Number);
    const want = new Date(row.endsAt);
    const diffMin = Math.abs((want.getHours() * 60 + want.getMinutes()) - (h * 60 + m));
    return diffMin <= 3;
  });
}

// НАБЛЮДЕНИЕ ЗА ТОРГАМИ. Паша, 24.10.2026: «сходи на 1 аукцион, изучи как это работает».
// Пока ремесло занято, на странице только список с отсчётами - ни формы, ни ссылки ставки. Значит
// устройство торгов видно ровно в те минуты, когда отсчёт кончился. Поэтому за три минуты до срока
// приходим на доску и снимаем её каждые полминуты, пока идут торги: каждый НОВЫЙ вид страницы
// пишется в auction_observe.jsonl - по этой записи потом и разбирать, а не по догадкам.
//
// Ставок НЕ делаем: Паша просил изучить. Семена - ресурс, и ставка это действие наружу.
const OBSERVE_FILE = path.join(__dirname, '..', 'auction_observe.jsonl');
const OBSERVE_LEAD_MS = 3 * 60 * 1000;
const OBSERVE_MAX_MS = Number(process.env.AI_AUCTION_OBSERVE_MS || 20 * 60 * 1000);
const OBSERVE_STEP_MS = 30 * 1000;

async function observeAuction(page, prof, endsAt) {
  const started = Date.now();
  let seen = 0;
  let lastSig = '';
  console.log(`Аукцион ${prof}: сроки подошли - иду смотреть торги (снимаю доску до ${Math.round(OBSERVE_MAX_MS / 60000)} мин).`);
  while (Date.now() - started < OBSERVE_MAX_MS) {
    // Просьбу «нужен голем» не задерживаем ни на минуту: у неё названная секунда.
    try {
      if (require('./golem').golemDueWithinMs(2 * 60 * 1000)) {
        console.log(`Аукцион ${prof}: подошёл срок голема - наблюдение прерываю.`);
        break;
      }
    } catch (e) { /* модуль мог не загрузиться - наблюдение не повод падать */ }
    const text = await openBoard(page);
    if (!text) { console.log(`Аукцион ${prof}: доска не открылась - бросаю наблюдение.`); break; }
    const flat = text.replace(/\s+/g, ' ').replace(/\d{1,2}:\d{2}:\d{2}/g, '').trim();
    if (flat !== lastSig) {
      lastSig = flat;
      seen += 1;
      const links = await page.$$eval('a', (as) => as.map((a) => (a.innerText || '').trim()).filter(Boolean)).catch(() => []);
      const forms = await page.$$eval('form', (fs) => fs.map((f) => ({
        action: f.getAttribute('action'),
        fields: Array.from(f.querySelectorAll('input,select,textarea')).map((i) => `${i.name || '-'}:${i.type || i.tagName}`),
      }))).catch(() => []);
      const row = { ts: new Date().toISOString(), prof, endsAt: new Date(endsAt).toISOString(), text: flat.slice(0, 2000), links, forms };
      try { fs.appendFileSync(OBSERVE_FILE, JSON.stringify(row) + String.fromCharCode(10)); } catch (e) { /* журнал не критичен */ }
      console.log(`Аукцион ${prof}: экран ${seen} - ${flat.slice(0, 200)}`);
      if (forms.length) console.log(`Аукцион ${prof}: НА СТРАНИЦЕ ФОРМА: ${JSON.stringify(forms)}`);
    }
    await new Promise((r) => setTimeout(r, OBSERVE_STEP_MS));
  }
  console.log(`Аукцион ${prof}: наблюдение закончил, разных экранов ${seen}. Запись в auction_observe.jsonl.`);
}

async function runAuctionRemindersIfDue(page) {
  const now = Date.now();
  if (now - (S.auctionBoardAt || 0) >= READ_EVERY_MS) {
    const text = await openBoard(page);
    const parsed = parseAuctionBoard(text, Date.now());
    S.auctionBoardAt = now;
    if (!parsed.rows.length) {
      // В Telegram молчим, в лог пишем: пустая доска - повод посмотреть глазами.
      console.log(`Аукционы: доска не разобралась. Текст: ${text.replace(/\s+/g, ' ').slice(0, 300)}`);
      persistDailyQuestState();
      return false;
    }
    if (Number.isFinite(parsed.seeds)) S.auctionSeeds = parsed.seeds;
    S.auctionBoard = parsed.rows.map(({ prof, level, what, holder, endsAt }) => ({ prof, level, what, holder, endsAt }));
    persistDailyQuestState();
    if (parsed.unknown.length) console.log(`Аукционы: строки без отсчёта: ${parsed.unknown.join(' // ')}`);
    const soon = parsed.rows.slice().sort((a, b) => a.endsAt - b.endsAt)[0];
    console.log(`Аукционы: доска прочитана, семян ${Number.isFinite(parsed.seeds) ? parsed.seeds : '?'}; ближайший - ${soon.prof}, ${dayKey(soon.endsAt)} ${hhmm(soon.endsAt)}.`);
  }

  const board = Array.isArray(S.auctionBoard) ? S.auctionBoard : [];
  const today = dayKey(now);

  // Наблюдение за торгами: один раз на ремесло в день, когда до срока меньше трёх минут.
  const watchDay = (S.auctionWatched && S.auctionWatched.day === today && S.auctionWatched.profs) || [];
  const soon = board.find((a) => dayKey(a.endsAt) === today && a.endsAt - now <= OBSERVE_LEAD_MS
    && a.endsAt - now > -OBSERVE_MAX_MS && !watchDay.includes(a.prof));
  if (soon) {
    S.auctionWatched = { day: today, profs: [...watchDay, soon.prof] };
    persistDailyQuestState();
    await observeAuction(page, soon.prof, soon.endsAt);
    return true;
  }

  const sentMap = (S.auctionSent && S.auctionSent.day === today && S.auctionSent.kinds) || {};
  const groups = new Map(); // вид напоминания -> [что сказать про каждое ремесло]
  const kinds = { ...sentMap };
  for (const a of board) {
    if (dayKey(a.endsAt) !== today) continue;
    const sent = sentMap[a.prof] || [];
    const due = dueReminder(a.endsAt, sent, now);
    if (!due) continue;
    kinds[a.prof] = [...sent, due.kind];
    if (!groups.has(due.kind)) groups.set(due.kind, []);
    groups.get(due.kind).push(`${a.prof} в ${hhmm(a.endsAt)}`);
  }
  if (!groups.size) return false;

  S.auctionSent = { day: today, kinds };
  persistDailyQuestState();
  const head = { 'утро': 'Сегодня аукцион', '3ч': 'Через 3 часа аукцион', '10м': 'Через 10 минут аукцион' };
  for (const [kind, parts] of groups) {
    const text = `${head[kind]}${parts.length > 1 ? 'ы' : ''} в Городе Мастеров: ${parts.join(', ')}`;
    if (kind === '10м') {
      // Рассылка идёт на весь мир, поэтому перед ней ПЕРЕСПРАШИВАЕМ игру. 21.10.2026 мой
      // проверочный прогон оставил в состоянии поддельную доску, драйвер прочитал её при старте и
      // разослал спамом аукцион, которого нет. Запись в состоянии - не основание для действия
      // наружу; основание - живая страница.
      if (!(await boardConfirms(page, parts))) {
        console.log(`АУКЦИОН (10м): живая доска не подтверждает «${text}» - рассылку отменил.`);
        continue;
      }
      await sendSpam(page, text);
      console.log(`АУКЦИОН (10м) -> спам на доску событий: «${text}»`);
    } else {
      appendOutbox(text);
      console.log(`АУКЦИОН (${kind}) -> клановый зал room=${CLAN_HALL_ROOM}: «${text}»`);
    }
  }
  return true;
}
