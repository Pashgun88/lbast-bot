// ВАЖНО: тест пишет в СВОЙ файл состояния. 21.10.2026 он записал поддельную доску в рабочий,
// драйвер прочитал её при старте и разослал спамом несуществующий аукцион.
process.env.AI_STATE_FILE = require('path').join(require('os').tmpdir(), 'ai_test_state.json');
// Проверка текста для зала без игры: подставляем доску в состояние и зовём шаг с «уже прочитанной»
// доской (метку чтения ставим свежей, чтобы в игру не ходить).
const { S } = require('./lib/state');
const { runAuctionRemindersIfDue } = require('./lib/auction_watch');
const fs = require('fs');
const OUT = require('path').join(__dirname, 'chat_outbox.json');
const before = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : null;
const at = (h, m) => { const d = new Date(); d.setHours(h, m, 0, 0); return d.getTime(); };
S.auctionBoardAt = Date.now();
S.auctionSeeds = 2;
S.auctionSent = {};
S.auctionBoard = [
  { prof: 'Винокур', level: 10, what: 'древний эль', holder: 'BlackOpium', endsAt: at(new Date().getHours() + 2, 0) },
  { prof: 'Травник', level: 11, what: 'эликсир кханту', holder: 'BUDDAHAM', endsAt: at(new Date().getHours() + 2, 0) },
];
(async () => {
  console.log('первый проход:', await runAuctionRemindersIfDue(null));
  console.log('второй проход (повтора быть не должно):', await runAuctionRemindersIfDue(null));
  console.log('что легло в outbox: ' + fs.readFileSync(OUT, 'utf8'));
  if (before === null) fs.unlinkSync(OUT); else fs.writeFileSync(OUT, before);
  console.log('outbox восстановлен');
})();
