// Сводка запасов для чата: чтобы AI__ не выдумывал, что у него есть и чем он занят.
//
// 24.10.2026, Паша прислал кусок кланового зала и спросил «это что за новости?»:
//   Tsunami: «Кинь Ханку зубы, у тебя много должно быть»
//   AI__: «зубов у меня нет, горгулий я не бил, только черепа с молега»
// В сумке в ту минуту лежало 23 зуба горгульи, а молега мы не бьём с 20.10 - фарм как раз
// горгулий. То есть автоответ сочинил и запас, и занятие: в промпте о них не было НИЧЕГО, а
// пустоту модель заполняет.
//
// Поэтому раз в два часа пишем файл с фактами (chat_facts.json): что лежит в сумке из обменного,
// где фарм и сколько денег. Промпт чата подмешивает его блоком <запасы>, и правило там простое:
// про наличие говорить только по этому блоку, чего в нём нет - «гляну и отпишу».

module.exports = { writeStockFactsIfDue };

const fs = require('fs');
const path = require('path');
const { S, persistDailyQuestState } = require('./state');
const { getBodyText } = require('./core');

const STOCK_FILE = path.join(__dirname, '..', 'chat_facts.json');
const EVERY_MS = 2 * 60 * 60 * 1000;
const PAGES = ['inv.php', 'inv.php?cpage=2', 'inv.php?cpage=3', 'inv.php?cpage=4'];

// Что людям интересно и чем мы торгуем. Остальное в чат не нужно.
const WATCH = [
  'Зуб Горгульи', 'Череп', 'Лист Змеевика', 'Крыло Василиска', 'Язык призрачного варана',
  'Медальон бандита', 'Костяная цепь бандита', 'Эликсир каменного голема',
  'Эликсир исцеления (HP+480)', 'Праздничный эль', 'Брага', 'Жареная рыба', 'Карась',
  'Выделанная кожа', 'Семена оливкового дерева',
];

async function writeStockFactsIfDue(page) {
  if (Date.now() - (S.stockFactsAt || 0) < EVERY_MS) return false;
  const counts = {};
  let money = null;
  for (const u of PAGES) {
    const ok = await page.goto(`http://lbast.ru/${u}`, { waitUntil: 'domcontentloaded', timeout: 60000 })
      .then(() => true).catch(() => false);
    if (!ok) continue;
    const text = (await getBodyText(page).catch(() => '')).replace(/[ \t]+/g, ' ');
    if (money === null) {
      const m = text.match(/У вас (\d+) дин/);
      if (m) money = Number(m[1]);
    }
    for (const line of text.split('\n')) {
      const l = line.trim();
      for (const name of WATCH) {
        if (!l.toLowerCase().startsWith(name.toLowerCase())) continue;
        const tail = l.slice(name.length).trim();
        const n = /^\d+$/.test(tail) ? Number(tail) : 1;
        counts[name] = Math.max(counts[name] || 0, n); // одна и та же строка попадается на двух вкладках
      }
    }
  }
  S.stockFactsAt = Date.now();
  persistDailyQuestState();
  const facts = {
    at: new Date().toISOString(),
    level: S.charLevel || null,
    money,
    farm: process.env.AI_FARM_SPOT === 'hides' ? 'кабан и бизон' : 'горгулья (молега не бьём до 11 уровня с новым комплектом - Паша, 27.10.2026)',
    items: counts,
  };
  try { fs.writeFileSync(STOCK_FILE, JSON.stringify(facts, null, 1)); } catch (e) { return false; }
  console.log(`Сводка запасов: ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(', ') || 'обменного в сумке нет'}.`);
  return true;
}

// Путь экспортируем в конце: const не всплывает, в шапке это TDZ-ошибка.
module.exports.STOCK_FILE = STOCK_FILE;
