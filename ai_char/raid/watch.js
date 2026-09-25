// Ведение боя «Забытые горы» по ОТКРЫТОМУ логу боя (Паша 24.09.2026: «логи боев полностью открытые,
// тебе не нужно никуда ходить, просто по моей анкете - персонаж в бою можешь смотреть прошлый бой
// или текущий»).
//
// Страница: log_infa.php?blogin=<ник>&mod=lastbojview - лог последнего/текущего боя любого игрока.
// Читаем раз в POLL_MS, берём свежий раунд, распознаём ОБЪЯВЛЕННОЕ намерение духа и говорим, какой
// свиток кидать. По умолчанию в чат НЕ пишем (--say включает отправку в клановый зал).
//
// Запуск (драйвер должен быть остановлен - профиль Chrome один):
//   node raid/watch.js --nick=Tsunami --roster="Hank:22, Varus:20, 2s19:14" [--say] [--room=12]
//
// Формулировки и механика сняты с НАСТОЯЩЕГО лога боя (Паша прислал 25.09.2026: 10 участников,
// дух 8000 HP, убит за 21 раунд, бой 8,5 минут). Что этот лог показал, помимо точных фраз:
//  - раунд = удар ОДНОГО бойца, а не залп группы (памятка обещала «три раунда» - их было 21);
//  - свиток силы даёт +75% урона, свиток слабости режет урон ДУХА вдвое, медлительность сбивает ему
//    уворот; пока дух вне телесной оболочки, урон по нему ровно 0;
//  - дух сначала ОБЪЯВЛЯЕТ намерение, а в раунде может сделать другое: строка «Дух подземелья
//    меняет намерения» встретилась 4 раза из 21;
//  - порядок действий бойца: «бросает пары» -> «применяет свиток» -> удар.

const { chromium } = require('playwright');
const m = require('../module');
const { parseRoster, scrollsFor } = require('./plan');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const arg = (name, def) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : def;
};
const flag = (name) => process.argv.includes(`--${name}`);

const NICK = arg('nick', 'Tsunami');
const ROOM = Number(arg('room', 12)); // клановый зал
const POLL_MS = Number(arg('poll', 2500));
const SAY = flag('say');
const MAX_MINUTES = Number(arg('minutes', 40));

// ОБЪЯВЛЕНИЯ намерения (будущее время) - по ним даём приказ.
const INTENTS = [
  {
    re: /Дух подземелья будет\s+атаковать/i,
    scroll: 'сила',
    who: 'хаи (17+)',
    why: 'под силой удар идёт с +75%: 1030 вместо 590',
  },
  {
    re: /Дух подземелья покинет\s+телесную\s+оболочку/i,
    scroll: 'слабость',
    who: 'мидлы (11-16)',
    why: 'урон по нему будет 0, зато он сам бьёт вдвое слабее',
  },
  {
    re: /Дух подземелья замедлит\s+реальность/i,
    scroll: 'медлительность',
    who: 'все',
    why: 'без медлительности он уворачивается от удара',
  },
];

// ИСПОЛНЕНИЕ намерения внутри раунда (настоящее время) - по нему видно, обманул дух или нет.
const RESOLUTIONS = [
  { re: /Дух подземелья атакует/i, name: 'атаковал' },
  { re: /Дух подземелья покидает\s+телесную\s+оболочку/i, name: 'вышел из оболочки' },
  { re: /Дух подземелья замедляет\s+реальность/i, name: 'замедлил реальность' },
];
const CHANGED_RE = /Дух подземелья меняет\s+намерения/i;
const BOSS_HP_RE = /Дух подземелья\s*\[\d+\]\s*\((-?\d+)\/(\d+)\)/;
const ROUND_NO_RE = /Раунд:\s*(\d+)/;

// Заголовок раунда: «19:40:15, Pubby [21] (459/3250) против Дух подземелья [100] (-340/8000)».
// Первая строка страницы тоже начинается со времени («14:32:56, Чт.») - это часы сайта, а не раунд,
// и первая версия принимала их за свежий раунд (живьём 24.09.2026).
const ROUND_HEAD_RE = /^\d{1,2}:\d{2}:\d{2},\s+(?!(Пн|Вт|Ср|Чт|Пт|Сб|Вс)[.,\s]*$)/;

function newestRound(text) {
  const lines = String(text || '').split('\n').map((l) => l.trim()).filter(Boolean);
  const start = lines.findIndex((l) => ROUND_HEAD_RE.test(l));
  if (start < 0) return '';
  const out = [lines[start]];
  for (let i = start + 1; i < lines.length; i++) {
    if (ROUND_HEAD_RE.test(lines[i]) || lines[i] === '-') break;
    out.push(lines[i]);
  }
  return out.join('\n');
}

function detectIntent(text) {
  for (const it of INTENTS) if (it.re.test(text)) return it;
  return null;
}

function orders(intent, roster) {
  if (!intent) return null;
  const fighters = roster.filter((f) => f.level >= 11);
  if (!fighters.length) return `${intent.scroll.toUpperCase()} и удар (${intent.why}).`;
  const throwers = intent.scroll === 'медлительность'
    ? fighters
    : fighters.filter((f) => (scrollsFor(f.level)[intent.scroll] || 0) > 0);
  const rest = fighters.filter((f) => !throwers.includes(f));
  const names = (arr) => arr.map((f) => f.nick || `[${f.level}]`).join(', ');
  let s = `${intent.scroll.toUpperCase()}: ${names(throwers) || intent.who} - пары, свиток, удар.`;
  if (rest.length) s += ` Остальные (${names(rest)}) просто бьют.`;
  return s;
}

// Экспорт для проверок: при require файл ничего не запускает (браузер поднимается только при
// прямом вызове `node raid/watch.js`).
module.exports = { INTENTS, RESOLUTIONS, CHANGED_RE, BOSS_HP_RE, ROUND_NO_RE, newestRound, detectIntent, orders };

async function main() {
  const roster = parseRoster(arg('roster', ''));
  console.log(`Рейд: слежу за боем ${NICK}, опрос раз в ${POLL_MS} мс, отправка в чат: ${SAY ? `ДА (room=${ROOM})` : 'нет (только лог)'}.`);
  if (roster.length) console.log(`Состав: ${roster.map((f) => `${f.nick}[${f.level}]`).join(', ')}`);

  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const chat = SAY ? await ctx.newPage() : null;
  const url = `http://lbast.ru/log_infa.php?blogin=${encodeURIComponent(NICK)}&mod=lastbojview`;
  const deadline = Date.now() + MAX_MINUTES * 60_000;
  let lastRoundKey = '';
  let lastIntent = '';
  let deceits = 0;
  try {
    while (Date.now() < deadline) {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
      const text = await m.getBodyText(page).catch(() => '');
      const round = newestRound(text);
      const key = round.slice(0, 40);
      if (key && key !== lastRoundKey) {
        lastRoundKey = key;
        const hp = text.match(BOSS_HP_RE);
        const rno = text.match(ROUND_NO_RE);
        const resolution = RESOLUTIONS.find((r) => r.re.test(round));
        const changed = CHANGED_RE.test(round);
        if (changed) deceits += 1;
        const head = [
          rno ? `раунд ${rno[1]}` : null,
          hp ? `дух ${hp[1]}/${hp[2]}` : null,
          resolution ? `он ${resolution.name}` : null,
          changed ? `ПЕРЕДУМАЛ (уже ${deceits} раз)` : null,
        ].filter(Boolean).join(', ');
        console.log(`\n--- ${head}`);
        console.log(round.slice(0, 400));
        // Приказ - по ОБЪЯВЛЕНИЮ намерения (отдельная строка ниже раунда), а не по тому, что дух
        // уже сделал в прошлом раунде.
        const intent = detectIntent(text.slice(0, 2500)) || detectIntent(round);
        if (intent && intent.scroll !== lastIntent) {
          lastIntent = intent.scroll;
          const order = orders(intent, roster);
          console.log(`>>> ${order}`);
          if (SAY && chat) {
            await m.postChatMessage(chat, order, ROOM).catch((e) => console.log('чат:', e.message));
          }
        }
      }
      await sleep(POLL_MS);
    }
    console.log('Рейд: время наблюдения вышло.');
  } finally { await ctx.close(); }
}

if (require.main === module) main();
