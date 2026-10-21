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
// Городская ратуша. Но ходить НЕ НУЖНО: страница аукциона открывается прямой ссылкой
// loc.php?obj=5116&flag=100&mod=auction - проверено.
//
// Как устроено (из «О городе», замер 21.10.2026): семь ремёсел, каждое занято игроком на неделю, у
// каждого в ратуше свой отсчёт («Винокур - BlackOpium еще 3 дн.»). Отсчёт кончился - по этому
// ремеслу идёт аукцион. Платят не динами, а СЕМЕНАМИ оливкового дерева: шаг не меньше 3 семян,
// ставка держится 6 минут, не перебили - аукцион закрыт. Семена падают в боях с шансом уровень/4,
// на руках больше 150 не держится, перебитая ставка семян не теряет.
// Ценз по уровню: Винокур 10, Травник 11, Аптекарь 12, Мэр города 13 (1000 дин в день и ничего не
// делает), Мясник 14, Кузнец 15, Перчаточник 16.
//
// Отсчёт игра печатает грубо, пока далеко («еще 3 дн.»), и точно, когда близко («еще 2 дн. 7 ч.
// 30 мин.»). Поэтому доску перечитываем раз в 2 часа: к самому дню аукциона время уже точное.

module.exports = { runAuctionRemindersIfDue, parseAuctionBoard, dueReminder };

const { S, persistDailyQuestState } = require('./state');
const { getBodyText } = require('./core');

const BOARD_URL = 'http://lbast.ru/loc.php?obj=5116&flag=100&mod=auction';
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

async function runAuctionRemindersIfDue(page) {
  const now = Date.now();
  if (now - (S.auctionBoardAt || 0) >= READ_EVERY_MS) {
    await page.goto(BOARD_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    const text = await getBodyText(page).catch(() => '');
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
  let sentAny = false;
  for (const a of board) {
    if (dayKey(a.endsAt) !== today) continue;
    const sentMap = (S.auctionSent && S.auctionSent.day === today && S.auctionSent.kinds) || {};
    const sent = sentMap[a.prof] || [];
    const due = dueReminder(a.endsAt, sent, now);
    if (!due) continue;
    S.auctionSent = { day: today, kinds: { ...sentMap, [a.prof]: [...sent, due.kind] } };
    persistDailyQuestState();
    const mine = (S.charLevel || 0) >= a.level ? 'нам по уровню' : `нужен ${a.level} ур.`;
    // Строка уходит в Telegram по шаблону /^АУКЦИОН/ в telegram_alerts.js.
    console.log(`АУКЦИОН ${due.text}: ${a.prof} (${a.what}), держит ${a.holder}, ${mine}. Семян у нас ${S.auctionSeeds ?? '?'}, шаг 3.`);
    sentAny = true;
  }
  return sentAny;
}
