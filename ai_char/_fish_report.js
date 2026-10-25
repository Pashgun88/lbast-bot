// Сводка по журналу рыбалки: где выгоднее подсекать. Запуск: node ai_char/_fish_report.js
const fs = require('fs');
const path = require('path');
const rows = fs.readFileSync(path.join(__dirname, 'fish_fort_log.jsonl'), 'utf8')
  .split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
const by = new Map();
for (const r of rows) {
  const k = r.stopStep;
  if (!by.has(k)) by.set(k, []);
  by.get(k).push(r);
}
console.log('шаг  попыток  срывов  срыв%   ср.кг   кг при удаче');
for (const k of [...by.keys()].sort((a, b) => a - b)) {
  const v = by.get(k);
  const esc = v.filter((r) => r.escaped);
  const got = v.filter((r) => !r.escaped);
  const avg = v.reduce((a, r) => a + (r.kg || 0), 0) / v.length;
  const avgG = got.length ? got.reduce((a, r) => a + (r.kg || 0), 0) / got.length : 0;
  console.log(`${String(k).padStart(3)} ${String(v.length).padStart(8)} ${String(esc.length).padStart(7)} ${String(Math.round(100 * esc.length / v.length)).padStart(6)}% ${avg.toFixed(3).padStart(7)} ${avgG.toFixed(3).padStart(14)}`);
}
console.log(`всего попыток: ${rows.length}`);
