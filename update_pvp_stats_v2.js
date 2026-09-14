/**
 * Парсит PvP-логи и обновляет pvp_statistika.xlsx.
 *
 * Для уклонений:
 *  - "долго ухохатываясь от осознания медлительности [Атакующий]" — атакующий явный
 *  - "успев дать леща [Атакующий]"                                 — атакующий явный
 *  - прочие уклонения                                              — атакующий выводится
 *    из контекста (кто именно сейчас дерётся с уклонившимся)
 *
 * Структура xlsx:
 *  Статистика  : ник, удары, %атака(голова/корпус/ноги), %блок(голова/корпус/ноги)
 *  Сырые строки: №строки, Атакующий, Защищающийся, Зона атаки, Кто блокировал, Зона блока, строка
 *  Пропущено   : №строки, строка    (только те, для кого нельзя установить атакующего)
 *  Пояснение   : счётчики
 */

const XLSX = require('xlsx');
const fs   = require('fs');

// ── Утилиты ───────────────────────────────────────────────────────────────────
function norm(z)  { return z === 'голову' ? 'голова' : z; }
const VALID_ZONES = new Set(['голова', 'корпус', 'ноги']);

// ── Паттерны ──────────────────────────────────────────────────────────────────
const PAT_FIGHT = /^\d{2}:\d{2}:\d{2}, (.+?) \[\d+\] \([-\d]+\/\d+\) против (.+?) \[\d+\] \(/;
const PAT_HIT2  = /^» (.+?) бьет в (голову|корпус|ноги) и наносит (.+?), блок\. (голову|корпус|ноги), удар на/;
const PAT_HIT1  = /^» (.+?) бьет в (голову|корпус|ноги) (.+?), но попадает в блок/;
// Уворот с явным именем атакующего — "ухохатываясь от осознания медлительности X"
const PAT_SLOW  = /^» (.+?) долго ухохатываясь от осознания медлительности (.+?) уходит от удара в (голову|корпус|ноги)/;
// Уворот с явным именем атакующего — "успев дать леща X"
const PAT_SLAP  = /^» (.+?) успев дать леща (.+?) уклоняется от удара в (голову|корпус|ноги)/;
// Зона в любой строке уклонения
const PAT_ZONE  = /(?:атаки|удара|выпада)(?: в)? (голову|корпус|ноги)/;

/**
 * Пытается превратить строку `» ` в запись сырых данных.
 * fighters — массив [playerA, playerB] из контекста боя, или null.
 * Возвращает [lineNum, atk, def, atkZone, blkBy, blkZone, line] или null.
 */
function tryParse(lineNum, line, fighters) {
  // Удар с частичным блоком
  const m2 = line.match(PAT_HIT2);
  if (m2) return [lineNum, m2[1], m2[3], norm(m2[2]), m2[3], norm(m2[4]), line];

  // Удар с полным блоком
  const m1 = line.match(PAT_HIT1);
  if (m1) { const z = norm(m1[2]); return [lineNum, m1[1], m1[3], z, m1[3], z, line]; }

  // Уворот: атакующий назван явно (медлительности)
  const mSlow = line.match(PAT_SLOW);
  if (mSlow) return [lineNum, mSlow[2], mSlow[1], norm(mSlow[3]), '', '', line];

  // Уворот: атакующий назван явно (дал леща)
  const mSlap = line.match(PAT_SLAP);
  if (mSlap) return [lineNum, mSlap[2], mSlap[1], norm(mSlap[3]), '', '', line];

  // Анонимный уворот — определяем атакующего из контекста боя
  const mZ = line.match(PAT_ZONE);
  if (mZ) {
    const zone     = norm(mZ[1]);
    const mDef     = line.match(/^» (\S+)/);
    const defender = mDef ? mDef[1] : '';
    if (fighters && defender) {
      const attacker = fighters.find(f => f !== defender) || '';
      if (attacker) return [lineNum, attacker, defender, zone, '', '', line];
    }
  }

  return null; // нельзя определить атакующего
}

/**
 * Парсит весь лог-файл с отслеживанием контекста боя.
 */
function parseLogFile(content) {
  const lines   = content.replace(/\r/g, '').split('\n');
  const rawRows  = [];
  const skipRows = [];
  let fighters   = null;

  for (let i = 0; i < lines.length; i++) {
    const line    = lines[i].trim();
    const lineNum = i + 1;

    const mF = line.match(PAT_FIGHT);
    if (mF) { fighters = [mF[1].trim(), mF[2].trim()]; continue; }

    if (!line.startsWith('»')) continue;

    const row = tryParse(lineNum, line, fighters);
    row ? rawRows.push(row) : skipRows.push([lineNum, line]);
  }
  return { rawRows, skipRows };
}

// ── Загружаем xlsx ────────────────────────────────────────────────────────────
const wb         = XLSX.readFile('pvp_statistika.xlsx');
const rawSheet   = XLSX.utils.sheet_to_json(wb.Sheets['Сырые строки'], { header: 1, defval: '' });
const skipSheet  = XLSX.utils.sheet_to_json(wb.Sheets['Пропущено'],    { header: 1, defval: '' });
const explSheet  = XLSX.utils.sheet_to_json(wb.Sheets['Пояснение'],    { header: 1, defval: '' });
const rawHeader  = rawSheet[0];
const skipHeader = skipSheet[0];

// Данные старого файла: первые 2024 боевых строки и первые 244 пропущенных
const oldFileRaw  = rawSheet.slice(1, 2025).filter(r => r[0] !== '');
const oldFileSkip = skipSheet.slice(1, 245).filter(r => r[0] !== '');

// ── Пытаемся разобрать старые пропущенные (без контекста боя) ─────────────────
const oldResolved = [];
const oldStillSkip = [];

for (const row of oldFileSkip) {
  const lineNum = row[0];
  const line    = String(row[1]).trim();
  const parsed  = tryParse(lineNum, line, null);
  parsed ? oldResolved.push(parsed) : oldStillSkip.push([lineNum, String(row[1])]);
}

// ── Парсим новый файл полностью (с контекстом) ───────────────────────────────
const { rawRows: newRaw, skipRows: newSkip } = parseLogFile(
  fs.readFileSync('Логи боев 2.txt', 'utf-8')
);

// ── Итоговые данные ───────────────────────────────────────────────────────────
// Старый файл (удары) + старые разобранные увороты + новый файл (удары + увороты)
const allRaw  = [...oldFileRaw, ...oldResolved, ...newRaw];
const allSkip = [...oldStillSkip, ...newSkip];

// ── Пересчёт статистики ───────────────────────────────────────────────────────
const stats = {};
function ensurePlayer(nick) {
  if (!stats[nick]) stats[nick] = {
    a: { голова: 0, корпус: 0, ноги: 0 },
    b: { голова: 0, корпус: 0, ноги: 0 },
  };
}

for (const row of allRaw) {
  const atk   = String(row[1]).trim();
  const atkZ  = String(row[3]).trim();
  const blkBy = String(row[4]).trim();
  const blkZ  = String(row[5]).trim();

  if (atk && VALID_ZONES.has(atkZ))   { ensurePlayer(atk);   stats[atk].a[atkZ]++; }
  if (blkBy && VALID_ZONES.has(blkZ)) { ensurePlayer(blkBy); stats[blkBy].b[blkZ]++; }
}

// ── Формируем лист Статистика ─────────────────────────────────────────────────
const STATS_HDR = [
  'Ник','Удары всего',
  '% атака голова','% атака корпус','% атака ноги',
  '% блок голова', '% блок корпус', '% блок ноги',
];

const statsRows = Object.entries(stats)
  .sort((a, b) => a[0].localeCompare(b[0]))
  .map(([nick, d]) => {
    const ta = d.a.голова + d.a.корпус + d.a.ноги;
    const tb = d.b.голова + d.b.корпус + d.b.ноги;
    return [
      nick, ta,
      ta ? d.a.голова/ta : 0,
      ta ? d.a.корпус/ta : 0,
      ta ? d.a.ноги/ta   : 0,
      tb ? d.b.голова/tb : 0,
      tb ? d.b.корпус/tb : 0,
      tb ? d.b.ноги/tb   : 0,
    ];
  });

function makeStatsSheet(header, rows) {
  const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
  const range = XLSX.utils.decode_range(ws['!ref']);
  for (let R = 1; R <= range.e.r; R++) {
    for (let C = 2; C <= 7; C++) {
      const cell = ws[XLSX.utils.encode_cell({ r: R, c: C })];
      if (cell && typeof cell.v === 'number') cell.z = '0.00%';
    }
  }
  return ws;
}

// ── Обновляем Пояснение ───────────────────────────────────────────────────────
for (const row of explSheet) {
  if (row[0] === 'Боевых строк учтено') row[1] = allRaw.length;
  if (row[0] === 'Строк пропущено')     row[1] = allSkip.length;
  if (row[0] === 'Игроков')             row[1] = Object.keys(stats).length;
}

// ── Записываем xlsx ───────────────────────────────────────────────────────────
wb.Sheets['Статистика']   = makeStatsSheet(STATS_HDR, statsRows);
wb.Sheets['Сырые строки'] = XLSX.utils.aoa_to_sheet([rawHeader,  ...allRaw]);
wb.Sheets['Пропущено']    = XLSX.utils.aoa_to_sheet([skipHeader, ...allSkip]);
wb.Sheets['Пояснение']    = XLSX.utils.aoa_to_sheet(explSheet);

fs.copyFileSync('pvp_statistika.xlsx', 'pvp_statistika_backup.xlsx');
XLSX.writeFile(wb, 'pvp_statistika.xlsx');

// ── Итоги ─────────────────────────────────────────────────────────────────────
console.log('=== Готово ===');
console.log(`Старый файл: ${oldFileRaw.length} боевых строк, ${oldFileSkip.length} пропущено`);
console.log(`  → разобрано из старых пропущенных: ${oldResolved.length} (всё с явным именем атакующего)`);
console.log(`  → нерешаемых без оригинала старого файла: ${oldStillSkip.length}`);
console.log(`Новый файл (Логи боев 2): ${newRaw.length} боевых строк, ${newSkip.length} пропущено`);
console.log(`Итого боевых строк: ${allRaw.length}`);
console.log(`Итого пропущено: ${allSkip.length}`);
console.log(`Игроков: ${Object.keys(stats).length}`);
