// База знаний по игре: пополнение и проверка.
// 16.10.2026, Паша: «ты можешь побольше информации по игре, вносить в базу данных и отвечать
// игрокам?» Файл - ai_char/kb/game_kb.jsonl, поиск - lib/game_kb.js, в ответы подмешивается
// блоком <знания> (chat_autoreply.js).
//
//   node ai_char/kb.js «Тема» «Факт одной-двумя фразами» [теги через пробел]
//   node ai_char/kb.js --find молег        - что найдётся по вопросу
//   node ai_char/kb.js --list              - вся база
//
// Правило: сюда идёт только замеренное, с числами. Ответ в чате от нашего имени должен быть верным.
const { addKbFact, recallKb, readKb } = require('./lib/game_kb');

const args = process.argv.slice(2);

if (args[0] === '--list') {
  const { rows } = readKb();
  console.log(`В базе ${rows.length} записей:`);
  rows.forEach((r) => console.log(`  [${r.topic}] ${r.text}`));
  process.exit(0);
}

if (args[0] === '--find') {
  const q = args.slice(1).join(' ');
  const got = recallKb(q, 3);
  console.log(got || `По «${q}» в базе ничего нет.`);
  process.exit(0);
}

if (args.length < 2) {
  console.log('Нужно: node ai_char/kb.js «Тема» «Факт» [теги]');
  process.exit(1);
}

const [topic, text, ...tags] = args;
const row = addKbFact({ topic, text, tags: tags.join(' ') });
console.log(`Добавил: [${row.topic}] ${row.text}`);
console.log(`Теперь в базе ${readKb().rows.length} записей.`);
