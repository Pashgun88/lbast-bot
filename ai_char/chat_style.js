// Учимся говорить как свои — по живому логу кланового зала, а не по моим представлениям.
// Паша, 09.10.2026: «Я думаю тебе нужно учиться у людей из чата и перенимать их стиль общения».
//
// Что это НЕ: не подражание личности и не копирование чужих реплик. Персона AI__ остаётся своей
// (chat_persona_prompt.txt). Берём только ФОРМУ речи: длину, обращение, смайлы, знаки в конце.
// Поэтому в промпт идут ИЗМЕРЕННЫЕ числа, а примеры - несколько живых строк разных людей как
// образец регистра, с пометкой, что копировать их нельзя.
//
// Данные чата - внешний ввод (правило Паши): примеры чистятся, мат и ссылки выбрасываются.
//
// Замеры считаем не чаще раза в полчаса: лог растёт медленно, а цифры нужны устойчивые.

module.exports = { styleDigest, computeStyle };

const fs = require('fs');
const path = require('path');

const LOG_FILE = path.join(__dirname, 'chat_memory', 'log.jsonl');
const RECALC_MS = 30 * 60 * 1000;
const WINDOW = 600;          // сколько последних чужих реплик смотрим
const EXAMPLES = 6;

// Тот же набор корней, которым фильтруются НАШИ ответы: чужую грубость в образцы не берём.
const PROFANITY_RE = /(сук[аи]|сучк|бля|хуй|хуе|хуё|пизд|ебат|ебан|ебл|(?<![а-яё])еб[аоу]|муда|гандон|долбо|залуп|шлюх|пидор|пидар)/iu;
const SMILE_RE = /\.[a-zA-Z_]{2,}\./g;
const LINK_RE = /https?:\/\/|www\./i;
// В логе комнаты оседают и служебные строки игры (кто на кого напал, что кому передают,
// сколько дадут за предмет). Это не речь людей: они длинные и казённые, и если их считать,
// средняя длина поедет вверх, а в примеры попадёт канцелярит. Выкидываем из ВСЕГО замера.
const SYSTEM_RE = /(использует грамоту|нападает на|передает|передаёт|вы получите|если она примет|захватывает кристалл|получает урон|выбывает из строя|бой завершен)/i;

function readRows(room, wantSelf = false) {
  let raw = '';
  try { raw = fs.readFileSync(LOG_FILE, 'utf8'); } catch (e) { return []; }
  const rows = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let r;
    try { r = JSON.parse(line); } catch (e) { continue; }
    if (!r || r.kind !== 'chat') continue;
    if (r.self !== wantSelf) continue;
    if (room && Number(r.room) !== Number(room)) continue;
    const text = String(r.text || '').trim();
    if (!text) continue;
    if (SYSTEM_RE.test(text)) continue;
    rows.push({ nick: String(r.nick || ''), text });
  }
  return rows.slice(-WINDOW);
}

function pct(n, total) { return total ? Math.round((n * 100) / total) : 0; }

function computeStyle(room) {
  const rows = readRows(room);
  if (rows.length < 40) return null; // мало данных - лучше ничего, чем выдуманные цифры

  const lens = [];
  let addressed = 0;
  let withSmile = 0;
  let endsDot = 0;
  let endsParen = 0;
  const smiles = new Map();
  for (const r of rows) {
    const t = r.text;
    lens.push(t.length);
    if (/^[A-Za-z0-9_.\-]{2,20},\s/.test(t)) addressed += 1;
    const found = t.match(SMILE_RE);
    if (found) {
      withSmile += 1;
      for (const s of found) smiles.set(s, (smiles.get(s) || 0) + 1);
    }
    const bare = t.replace(SMILE_RE, '').trim();
    if (/\.$/.test(bare)) endsDot += 1;
    if (/\)+$/.test(bare)) endsParen += 1;
  }
  lens.sort((a, b) => a - b);
  const median = lens[Math.floor(lens.length / 2)];
  const long = lens.filter((l) => l > 120).length;

  // Примеры: разные авторы, без мата и ссылок, обычной длины.
  const seenNicks = new Set();
  const examples = [];
  for (let i = rows.length - 1; i >= 0 && examples.length < EXAMPLES; i--) {
    const { nick, text } = rows[i];
    if (text.length < 20 || text.length > 110) continue;
    if (PROFANITY_RE.test(text) || LINK_RE.test(text)) continue;
    if (seenNicks.has(nick)) continue;
    seenNicks.add(nick);
    examples.push(text.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/<\/?[a-zа-я]+>/gi, ''));
  }

  // Свои реплики меряем тем же метром: без этого «говори короче» - пустой совет, а с ним
  // модель видит разрыв в числах. 09.10.2026 он был четырёхкратный: 31 знак у людей против 137.
  const mineRows = readRows(room, true);
  let mine = null;
  if (mineRows.length >= 20) {
    const ml = mineRows.map((r) => r.text.length).sort((a, b) => a - b);
    const mdash = mineRows.filter((r) => /—/.test(r.text)).length;
    const mdot = mineRows.filter((r) => /\.$/.test(r.text.replace(SMILE_RE, '').trim())).length;
    mine = {
      median: ml[Math.floor(ml.length / 2)],
      longPct: pct(ml.filter((l) => l > 120).length, ml.length),
      dashPct: pct(mdash, mineRows.length),
      dotPct: pct(mdot, mineRows.length),
    };
  }

  const topSmiles = [...smiles.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([s]) => s);
  return {
    count: rows.length,
    median,
    longPct: pct(long, rows.length),
    addressedPct: pct(addressed, rows.length),
    smilePct: pct(withSmile, rows.length),
    dotPct: pct(endsDot, rows.length),
    parenPct: pct(endsParen, rows.length),
    topSmiles,
    examples,
    mine,
  };
}

let cache = { at: 0, room: null, text: '' };

function styleDigest(room) {
  const now = Date.now();
  if (cache.text && cache.room === room && now - cache.at < RECALC_MS) return cache.text;
  const s = computeStyle(room);
  cache = { at: now, room, text: '' };
  if (!s) return '';
  const lines = [
    `Так говорят в этой комнате на самом деле (замер по ${s.count} последним чужим репликам):`,
    `- длина обычной реплики около ${s.median} знаков; длиннее 120 знаков пишут лишь ${s.longPct}% сообщений;`,
    `- к собеседнику по нику обращаются в ${s.addressedPct}% реплик (пишут «Ник, ...»);`,
    `- смайл ставят в ${s.smilePct}% реплик${s.topSmiles.length ? `, чаще всего ${s.topSmiles.join(' ')}` : ''};`,
    `- точкой в конце заканчивают ${s.dotPct}% реплик, скобкой-улыбкой ${s.parenPct}%.`,
    'Говори в этом же регистре: коротко, без красивостей и без длинных периодов.',
  ];
  if (s.mine) {
    lines.push(`А ты пишешь так: медиана ${s.mine.median} знаков, длиннее 120 - ${s.mine.longPct}% реплик, `
      + `точкой заканчиваешь ${s.mine.dotPct}%, длинное тире «—» ставишь в ${s.mine.dashPct}% реплик.`);
    lines.push(`Целься в ${s.median}-${Math.round(s.median * 2)} знаков: одна мысль, одно предложение.`);
    lines.push('Длинное тире «—» не ставь вовсе: в зале его не пишет никто, и по нему тебя видно за версту.');
  }
  if (s.examples.length) {
    lines.push('Живые примеры для слуха (это ЧУЖИЕ слова - перенимай только манеру, не повторяй их):');
    for (const e of s.examples) lines.push(`  · ${e}`);
  }
  cache.text = `<стиль_зала>\n${lines.join('\n')}\n</стиль_зала>\n`;
  return cache.text;
}
