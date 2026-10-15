// Отличаем просьбу от упоминания. Паша, 15.10.2026: «ты отличишь тригер от простого упоминания?»
// и сразу решение: «давай лкчше сделаем нужен голем». Эликсир один, поэтому проверяю разбор
// фразами, а не на живом применении: node ai_char/test_golem_trigger.js
const { classifyGolemMessage, parseGolemRequest, GOLEM_ALLOWED_RE } = require('./lib/golem');

const CASES = [
  // [фраза, ожидаемый исход, ожидаемая цель (если просьба)]
  ['нужен голем', 'request', 'Tsunami'],
  ['нужен голем в 16:52:44', 'request', 'Tsunami'],
  ['нужен голем на Hank', 'request', 'Hank'],
  ['нужен голем на Hank в 16:52:44', 'request', 'Hank'],
  // Паша, 15.10.2026: «нужен голем и любой ник который я или ханк назовем» - ник берётся из любого
  // места фразы, не только после «на».
  ['нужен голем Varus', 'request', 'Varus'],
  ['нужен голем Galla в 16:00', 'request', 'Galla'],
  // Паша, 15.10.2026: «ник только латиницей». Русское слово после «на» ником не считается:
  // цель пустая, и просьба не исполняется, а докладывается.
  ['нужен голем на Цунами', 'request', ''],
  // Русское слово без «на» ником НЕ считается - иначе применили бы на игрока «срочно».
  ['нужен голем срочно', 'request', 'Tsunami'],
  ['голем нужен', 'request', 'Tsunami'],
  // упоминания - делать ничего не надо
  ['голем', 'mention'],
  ['голем уже в кд', 'mention'],
  ['спасибо за голема', 'mention'],
  ['а голем есть?', 'mention'],
  ['нужен голем?', 'mention'],
  ['кинул голема на Hank, сработало', 'mention'],
  // отмена
  ['голем не нужен', 'cancel'],
  ['отмени голем', 'cancel'],
  ['голем не надо', 'cancel'],
  // вообще не про голема
  ['привет, как дела', 'none'],
  ['пошли на гарпий', 'none'],
];

let bad = 0;
for (const [text, want, wantTarget] of CASES) {
  const cls = classifyGolemMessage(text);
  let line = `${cls.kind === want ? 'ok  ' : 'ПЛОХО'} ${JSON.stringify(text)} -> ${cls.kind}${cls.why ? ` (${cls.why})` : ''}`;
  if (cls.kind !== want) { bad += 1; line += ` [ожидалось ${want}]`; }
  if (cls.kind === 'request') {
    const req = parseGolemRequest(text, 'Tsunami');
    const when = req.atMs ? new Date(req.atMs).toLocaleTimeString('ru-RU') : 'сразу';
    line += ` цель=${req.target} время=${when}`;
    if (wantTarget !== undefined && req.target !== wantTarget) { bad += 1; line += ` [ожидалась цель ${wantTarget === '' ? 'пустая' : wantTarget}]`; }
    if (req.badNick) line += ` (ник кириллицей: ${req.badNick} - не исполняю)`;
  }
  console.log(line);
}

// Чьи просьбы вообще слушаем.
for (const [nick, want] of [['Tsunami', true], ['Hank', true], ['Varus', false], ['Galla', false], ['Цунами', false]]) {
  const got = GOLEM_ALLOWED_RE.test(nick);
  if (got !== want) { bad += 1; console.log(`ПЛОХО ник ${nick}: ${got}, ожидалось ${want}`); }
  else console.log(`ok   ник ${nick}: ${got ? 'слушаю' : 'игнорирую'}`);
}

console.log(bad === 0 ? 'ВСЁ ВЕРНО' : `ОШИБОК: ${bad}`);
process.exit(bad === 0 ? 0 : 1);
