// Показать прогноз следующего уровня: node ai_char/exp.js
// Замеры копит драйвер раз в сутки (lib/exp_tracker.js, файл exp_log.jsonl).
const { formatForecast, readExpLog } = require('./lib/exp_tracker');
console.log(formatForecast());
const pts = readExpLog();
if (pts.length > 1) {
  console.log('\nЗамеры:');
  let prev = null;
  for (const p of pts) {
    const d = prev ? ` (+${(p.exp - prev.exp).toLocaleString('ru-RU')})` : '';
    console.log(`  ${p.day}  опыт ${p.exp.toLocaleString('ru-RU')}${d}, осталось ${p.left.toLocaleString('ru-RU')}`);
    prev = p;
  }
}
