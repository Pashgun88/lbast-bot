// База знаний по игре: практика, а не летописи.
// 16.10.2026, Паша: «я за тебя ответил в чате. Ты можешь побольше информации по игре, вносить в
// базу данных и отвечать игрокам?»
//
// Что уже было: lore/lore.jsonl - летописи мира (1623 записи, поиск в chat_memory.js recallLore)
// и память о людях. Чего не было: того, о чём игроки реально спрашивают - где кто стоит, сколько
// стоит, как работает механика. Эти знания у нас есть, но лежали в коде, в моих заметках и в
// комментариях, то есть отвечать по ним AI__ не мог.
//
// Правило наполнения: сюда идёт только ЗАМЕРЕННОЕ - то, что мы видели в игре своими глазами, с
// числами. Слухи и догадки не кладём: ответ в чате от нашего имени должен быть верным.

// Экспорт стоит ДО require: файлы lib/ вызывают друг друга по кругу, а объявления функций
// всплывают (hoisting), поэтому к моменту любого встречного require все функции уже здесь.
module.exports = { recallKb, addKbFact, readKb, kbStems };

const fs = require('fs');
const path = require('path');

const KB_FILE = process.env.AI_GAME_KB_FILE || path.join(__dirname, '..', 'kb', 'game_kb.jsonl');

// Основа слова: кириллица падежами меняет хвост, а \w в JS знает только латиницу - поэтому режем
// руками. Пять букв достаточно, чтобы «молега» и «молегу» стали одним словом.
function kbStems(text) {
  return String(text || '').toLowerCase().replace(/ё/g, 'е')
    .split(/[^a-zа-я0-9]+/).filter((w) => w.length >= 3)
    .map((w) => (w.length > 5 ? w.slice(0, 5) : w));
}

// Слова, которые есть почти в каждом вопросе и потому ничего не отбирают.
const KB_STOP = new Set(['кто', 'что', 'где', 'как', 'куда', 'зачем', 'почем', 'есть', 'был', 'была',
  'это', 'там', 'тут', 'она', 'они', 'мне', 'тебе', 'его', 'уже', 'ещё', 'еще', 'надо', 'нужн',
  'можн', 'буде', 'дела', 'знае', 'знаю', 'скаж', 'подск', 'люди', 'народ', 'всем', 'прив']);

let cache = { mtime: 0, rows: [], df: new Map() };
function readKb() {
  let st;
  try { st = fs.statSync(KB_FILE); } catch (e) { return cache; }
  if (st.mtimeMs === cache.mtime) return cache;
  const rows = [];
  for (const line of fs.readFileSync(KB_FILE, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line);
      if (!r || !r.text) continue;
      rows.push({ ...r, st: new Set(kbStems(`${r.topic || ''} ${r.tags || ''} ${r.text}`)) });
    } catch (e) { /* битая строка - пропускаем, база правится руками */ }
  }
  const df = new Map();
  rows.forEach((r) => r.st.forEach((w) => df.set(w, (df.get(w) || 0) + 1)));
  cache = { mtime: st.mtimeMs, rows, df };
  return cache;
}

// Порог ниже, чем у летописей: там высокий порог спасает от болтовни хроник, а здесь каждая
// запись - короткий ответ на конкретный вопрос, и попадание по одному редкому слову уже уместно.
const KB_MIN_HITS = Number(process.env.AI_KB_MIN_HITS || 1);

// Подборка знаний под вопрос. Возвращает готовый блок для промпта или пустую строку.
function recallKb(query, k = 3) {
  const { rows, df } = readKb();
  if (!rows.length) return '';
  const q = [...new Set(kbStems(query))].filter((w) => !KB_STOP.has(w));
  if (!q.length) return '';
  const scored = [];
  for (const r of rows) {
    let score = 0;
    let hits = 0;
    const topic = new Set(kbStems(`${r.topic || ''} ${r.tags || ''}`));
    for (const w of q) {
      if (!r.st.has(w)) continue;
      // Редкое слово весит больше частого: «молег» встречается в одной записи, «дин» - в десяти.
      const weight = Math.log(rows.length / (df.get(w) || 1)) + 0.2;
      score += topic.has(w) ? weight * 2 : weight;
      hits += 1;
    }
    if (hits >= KB_MIN_HITS && score > 0) scored.push({ r, score });
  }
  if (!scored.length) return '';
  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, k).map(({ r }) => `[${r.topic}] ${r.text}`);
  return `Что ты знаешь об этом по игре (отвечай своими словами, числа не путай):\n${top.join('\n')}`;
}

// Добавить факт. Пользуюсь из CLI (ai_char/kb.js): база растёт по ходу игры.
function addKbFact({ topic, text, tags = '' }) {
  if (!topic || !text) throw new Error('нужны topic и text');
  fs.mkdirSync(path.dirname(KB_FILE), { recursive: true });
  const row = { topic: String(topic), text: String(text), tags: String(tags), addedAt: new Date().toISOString().slice(0, 10) };
  fs.appendFileSync(KB_FILE, JSON.stringify(row) + '\n');
  cache.mtime = 0;
  return row;
}
