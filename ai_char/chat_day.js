// Дневник дня AI__: что он сегодня реально делал (Паша, 20.09.2026: «надо что то придумать для
// более интересного общения в чате»). Раньше модель не знала о жизни персонажа и потому крутила
// три байки - палица, потерянная буква, ополчение. Теперь события дня подаются в промпт, и говорить
// есть о чём: кого бил, что добыл, где получил по голове.
//
// Источник - строки, которые драйвер и так пишет в лог: их перехватывает console.log в
// telegram_alerts.js и отдаёт сюда noteEvent(). Хранится ai_char/chat_memory/day_events.jsonl
// (та же папка, что и память чата, она в .gitignore).

const fs = require('fs');
const path = require('path');

const DIR = process.env.AI_CHAT_MEMORY_DIR || path.join(__dirname, 'chat_memory');
const FILE = path.join(DIR, 'day_events.jsonl');
const MAX_LINES = 4000;

// Строка лога -> короткое человеческое событие. label может подставлять группы через $1.
const RULES = [
  [/^Boar farm: fight result=true/, 'бил кабанов в Лесах Эльсены'],
  [/^Bison farm: fight result=true/, 'валил бизонов у Дорожного креста'],
  [/^Harpy.*result=true/, 'дрался с гарпиями'],
  [/^Кухня: поджарил рыбу/, 'жарил рыбу у себя на кухне'],
  [/^Рыбалка:.*(поймал|улов)/, 'рыбачил'],
  [/персонаж выбыл из строя/, 'получил по голове так, что лежал и залечивался'],
  [/^Дейлик: ([^.,]{3,40})/, 'дейлик: $1'],
  [/^Зависание:/, null], // служебное, в чат не нужно
  [/грамота Тригмагистрата/i, 'принёс грамоту Тригмагистрата за охоту на демона'],
  [/Задание выполнено|Задание завершено/, 'закрыл задание'],
  [/\[Получен[оаы]? ([^\]]{2,50})\]/, 'добыл: $1'],
  [/Статуя славы: (?:поставил|обновил|баф)/, 'обновил Статую славы'],
  [/Дерево жизни.*(?:эликсир|готово|выполнено)/i, 'собирал сок с Дерева жизни'],
  [/^(Штольни|Смерть ростовщика|Крыша|Ожерелье|Шепот)[^\n]{0,40}(?:пройден|выполнен)/i, 'прошёл квест $1'],
  [/получен (\d+) уровень|Уровень повышен/i, 'взял новый уровень'],
  [/Ордо.*(?:выполнено|доложил)/i, 'отчитался в Ордо Экзекуторс'],
];

function ensureDir() {
  try { fs.mkdirSync(DIR, { recursive: true }); } catch (e) { /* есть */ }
}

const dayKey = (ts = Date.now()) => new Date(ts).toISOString().slice(0, 10);

// Вызывается на каждую строку лога драйвера. Дешёвая: до первого совпадения, дальше выходит.
function noteEvent(line) {
  const s = String(line || '');
  if (!s || s.length > 400) return;
  for (const [re, label] of RULES) {
    const m = s.match(re);
    if (!m) continue;
    if (!label) return;
    const text = label.replace(/\$(\d)/g, (_, n) => String(m[Number(n)] || '').trim());
    try {
      ensureDir();
      fs.appendFileSync(FILE, JSON.stringify({ ts: Date.now(), text }) + '\n');
    } catch (e) { /* дневник не должен ронять драйвер */ }
    return;
  }
}

function readToday() {
  let lines = [];
  try { lines = fs.readFileSync(FILE, 'utf8').split('\n').filter(Boolean); } catch (e) { return []; }
  if (lines.length > MAX_LINES) {
    try { fs.writeFileSync(FILE, lines.slice(-MAX_LINES).join('\n') + '\n'); } catch (e) { /* ладно */ }
    lines = lines.slice(-MAX_LINES);
  }
  const today = dayKey();
  const out = [];
  for (const l of lines) {
    try {
      const r = JSON.parse(l);
      if (dayKey(r.ts) === today) out.push(r);
    } catch (e) { /* битая строка */ }
  }
  return out;
}

// «раз/раза» - чтобы в реплике не выходило «2 раз».
const plural = (n) => (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 'раза' : 'раз');

// Строка для промпта: одинаковые события сворачиваются в «×N», свежие впереди.
// 21.09.2026, Паша: «ты это уже 3 раза повторил на моих глазах» - про бизонов у Дорожного креста,
// рыбу и грамоту. Дневник подавал модели одни и те же события в каждый промпт, и она вставляла их
// в любой ответ. Теперь, что уже рассказано в чате, из дневника выпадает - до следующего такого же
// события (новый бизон после рассказа - снова новость).
const TOLD_FILE = path.join(DIR, 'day_told.json');
function readTold() {
  try {
    const t = JSON.parse(fs.readFileSync(TOLD_FILE, 'utf8'));
    return t && t.day === dayKey() ? t : { day: dayKey(), told: {} };
  } catch (e) { return { day: dayKey(), told: {} }; }
}
// Основы значимых слов события (5 букв от слов длиннее 4): «валил бизонов у Дорожного креста» ->
// валил, бизон, дорож, крест. Кириллица явными классами - \w в JS её не видит.
const eventStems = (text) => String(text).toLowerCase().replace(/ё/g, 'е')
  .split(/[^а-яa-z]+/).filter((w) => w.length > 4).map((w) => w.slice(0, 5));
function markTold(reply) {
  const said = String(reply || '').toLowerCase().replace(/ё/g, 'е');
  if (!said) return;
  const rows = readToday();
  const t = readTold();
  let changed = false;
  for (const r of rows) {
    const stems = eventStems(r.text);
    const hits = stems.filter((st) => said.includes(st)).length;
    if (hits >= 1 && (t.told[r.text] || 0) < r.ts) { t.told[r.text] = r.ts; changed = true; }
  }
  if (changed) { try { ensureDir(); fs.writeFileSync(TOLD_FILE, JSON.stringify(t)); } catch (e) { /* ладно */ } }
}

function digest(maxChars = 400) {
  const told = readTold().told;
  // Событие, рассказанное после последнего своего повторения, - уже не новость.
  const rows = readToday().filter((r) => !(told[r.text] >= r.ts));
  if (!rows.length) return '';
  const counts = new Map();
  const lastAt = new Map();
  for (const r of rows) {
    counts.set(r.text, (counts.get(r.text) || 0) + 1);
    lastAt.set(r.text, r.ts);
  }
  const items = [...counts.entries()]
    .sort((a, b) => lastAt.get(b[0]) - lastAt.get(a[0]))
    .map(([text, n]) => (n > 1 ? `${text} (${n} ${plural(n)})` : text));
  let s = '';
  for (const it of items) {
    if (s.length + it.length + 2 > maxChars) break;
    s = s ? `${s}; ${it}` : it;
  }
  return s;
}

module.exports = { noteEvent, digest, markTold, FILE };
