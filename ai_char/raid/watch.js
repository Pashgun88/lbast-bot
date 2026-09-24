// Слежение за боем «Забытые горы» по ОТКРЫТОМУ логу боя (Паша 24.09.2026: «логи боев полностью
// открытые, тебе не нужно никуда ходить, просто по моей анкете - персонаж в бою можешь смотреть
// прошлый бой или текущий»).
//
// Страница: log_infa.php?blogin=<ник>&mod=lastbojview - это лог последнего/текущего боя любого
// игрока. Читаем раз в POLL_MS, вытаскиваем самый свежий раунд и намерение духа, и говорим, что
// делать. По умолчанию НИЧЕГО не пишем в чат (--say включает отправку в клановый зал) - сперва
// смотрим глазами, верно ли распознаём.
//
// Запуск (драйвер должен быть остановлен - профиль Chrome один):
//   node raid/watch.js --nick=Tsunami --roster="Hank:22, Varus:20, 2s19:14" [--say] [--room=12]
//
// Намерения духа (памятка Linda): «будет атаковать» -> сила, «покинет телесную оболочку» ->
// слабость, «замедлит реальность» -> медлительность. Дух может менять намерение по ходу боя.

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

const INTENTS = [
  { re: /будет\s+атаковать/i, scroll: 'сила', who: 'хаи (15+)' },
  { re: /покин(ет|ул|ает)[^.]{0,20}оболочк/i, scroll: 'слабость', who: 'мидлы (11-14)' },
  { re: /замедл[^.]{0,20}реальност/i, scroll: 'медлительность', who: 'все' },
];

// Строка-заголовок раунда: «14:15:05, Tsunami [21] (700/3230) против Призрак Блейка [23] ...».
// Первая строка страницы тоже начинается со времени («14:32:56, Чт.») - это часы сайта, не раунд,
// и первая версия принимала их за свежий раунд (живьём 24.09.2026).
const ROUND_HEAD_RE = /^\d{1,2}:\d{2}:\d{2},\s+(?!(Пн|Вт|Ср|Чт|Пт|Сб|Вс)[.,\s]*$)/;

function newestRound(text) {
  // Раунды идут блоками, самый свежий сверху, каждый начинается с времени «14:15:05,».
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
  if (!fighters.length) return `Кидаем ${intent.scroll.toUpperCase()} и бьём.`;
  const throwers = intent.scroll === 'медлительность'
    ? fighters
    : fighters.filter((f) => (scrollsFor(f.level)[intent.scroll] || 0) > 0);
  const rest = fighters.filter((f) => !throwers.includes(f));
  const names = (arr) => arr.map((f) => f.nick || `[${f.level}]`).join(', ');
  let s = `${intent.scroll.toUpperCase()}: кидают ${names(throwers) || intent.who} - потом удар.`;
  if (rest.length) s += ` Остальные (${names(rest)}) просто бьют.`;
  return s;
}

(async () => {
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
  try {
    while (Date.now() < deadline) {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
      const text = await m.getBodyText(page).catch(() => '');
      const round = newestRound(text);
      const key = round.slice(0, 40);
      if (key && key !== lastRoundKey) {
        lastRoundKey = key;
        console.log(`\n--- ${round.slice(0, 400)}`);
        const intent = detectIntent(round) || detectIntent(text.slice(0, 1500));
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
})();
