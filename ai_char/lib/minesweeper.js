// Мини-игра «сапёр»: заросли с ядовитыми шипами. Встречается в двух местах и с разными размерами:
//   * «Жертвоприношение» (guides/zhertva*.steps, директива @grid) - сетка 6x6;
//   * сбор трав (lib/quests_story.js, экран «Искать травы») - сетка 4x4.
// Логика была написана 27.09.2026 только под 6x6 и лежала внутри guides/guide_run.js. 12.10.2026
// выяснилось, почему пять дней «рвём все травки» не давали ни одной травы: сбор трав тыкал клетки
// подряд (1, 2, 3...) и на третьей-четвёртой натыкался на шип - «Вы укололись о ядовитый шип и
// ничего не нашли!», попытка на сутки сгорала. Решатель был рядом, но не переиспользован, потому
// что жёстко требовал ровно шесть столбцов. Поэтому он здесь, общий, и размер читается из экрана.
//
// Экран: клетки - ссылки с текстом «*»; открытая клетка показывает ЦИФРУ (сколько шипов рядом),
// а налетевший шип - «#». Две ловушки, на которых я уже спотыкался:
//   * обычный сборщик ссылок клетки не видит: он срезает ведущую «*» и выбрасывает пустой текст;
//   * выходить из цикла по слову «шип» нельзя - оно есть в самом описании зарослей, всегда.
// Ссылки идут в том же порядке, что клетки в тексте, поэтому k-я закрытая клетка = k-я ссылка.

module.exports = { parseGrid, solveGrid, pickGridCell, gridCellIndex };

// Плотность шипов нам неизвестна, поэтому клетке без подсказок ставим такой риск: он выше
// «1 из 8» и «1 из 5» (рядом с цифрой 1), но ниже «1 из 3» - то есть рядом с цифрами мы ходим,
// пока подсказка не стала слишком плотной.
const DEFAULT_RISK = 0.25;
const MIN_SIZE = 3;
const MAX_SIZE = 8;

// Сетка на экране: подряд идущие строки одинаковой длины из «*», цифр и «#».
function parseGrid(text) {
  const lines = String(text || '').split(new RegExp(String.raw`\r?\n`));
  let best = null;
  let run = [];
  const flush = () => {
    if (run.length >= MIN_SIZE && run.length === run[0].length && (!best || run.length > best.length)) best = run.slice();
    run = [];
  };
  for (const line of lines) {
    const cells = line.trim().split(new RegExp(String.raw`[\s\t]+`));
    const ok = cells.length >= MIN_SIZE && cells.length <= MAX_SIZE
      && cells.every((c) => c === '*' || c === '#' || /^[0-9]$/.test(c))
      && (run.length === 0 || cells.length === run[0].length);
    if (ok) run.push(cells); else flush();
  }
  flush();
  return best;
}

function solveGrid(rows) {
  const n = rows.length;
  const key = (r, c) => r + ',' + c;
  const at = (r, c) => (r >= 0 && r < n && c >= 0 && c < n ? rows[r][c] : null);
  const around = (r, c) => {
    const out = [];
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      if (dr || dc) { const v = at(r + dr, c + dc); if (v !== null) out.push([r + dr, c + dc, v]); }
    }
    return out;
  };
  const digits = [];
  const unknown = [];
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    if (rows[r][c] === '*') unknown.push([r, c]);
    else if (/^[0-9]$/.test(rows[r][c])) digits.push([r, c, Number(rows[r][c])]);
  }
  const thorns = new Set();
  for (let pass = 0; pass < 8; pass++) {
    let changed = false;
    for (const [r, c, d] of digits) {
      const nb = around(r, c).filter(([, , v]) => v === '*');
      const open = nb.filter(([rr, cc]) => !thorns.has(key(rr, cc)));
      const known = nb.length - open.length;
      if (open.length && d - known === open.length) {
        for (const [rr, cc] of open) thorns.add(key(rr, cc));
        changed = true;
      }
    }
    if (!changed) break;
  }
  // Правило подмножеств (в сапёре это «1-2»). Живой случай 12.10.2026, сетка ****/****/****/**11:
  // угловая «1» требует один шип среди {(3,3),(3,4)}, соседняя «1» - один шип среди
  // {(3,2),(3,3),(3,4),(4,2)}. Первое множество целиком внутри второго, значит остаток
  // {(3,2),(4,2)} шипов не содержит вовсе - обе клетки безопасны ТОЧНО. Прежний решатель этого не
  // выводил и шёл гадать, хотя знать было можно.
  const safeSet = new Set();
  const addSafe = (rr, cc) => { if (!thorns.has(key(rr, cc))) safeSet.add(key(rr, cc)); };
  const constraints = () => digits.map(([r, c, d]) => {
    const nb = around(r, c).filter(([, , v]) => v === '*');
    const open = nb.filter(([rr, cc]) => !thorns.has(key(rr, cc)) && !safeSet.has(key(rr, cc)));
    return { cells: open.map(([rr, cc]) => key(rr, cc)), left: d - (nb.length - open.length) };
  }).filter((x) => x.cells.length);
  for (let pass = 0; pass < 8; pass++) {
    let changed = false;
    const cons = constraints();
    for (const a of cons) {
      // Все шипы этой подсказки уже найдены - остальные её соседи безопасны.
      if (a.left === 0) {
        for (const k of a.cells) if (!safeSet.has(k)) { safeSet.add(k); changed = true; }
        continue;
      }
      if (a.left === a.cells.length) {
        for (const k of a.cells) if (!thorns.has(k)) { thorns.add(k); changed = true; }
        continue;
      }
      for (const b of cons) {
        if (a === b) continue;
        if (!a.cells.every((k) => b.cells.includes(k))) continue; // a не подмножество b
        const rest = b.cells.filter((k) => !a.cells.includes(k));
        if (!rest.length) continue;
        const left = b.left - a.left;
        if (left === 0) {
          for (const k of rest) if (!safeSet.has(k)) { safeSet.add(k); changed = true; }
        } else if (left === rest.length) {
          for (const k of rest) if (!thorns.has(k)) { thorns.add(k); changed = true; }
        }
      }
    }
    if (!changed) break;
  }
  const safe = [...safeSet].map((k) => k.split(',').map(Number));

  // Оценка риска клетки. Раньше тут была сумма соседних цифр - «подальше от того, что пахнет
  // шипами». Это уводит и от информации: клетка рядом с «1», у которой восемь незакрытых
  // соседей, рискует на 1/8, а клетка в стороне от всех цифр - на всю плотность шипов, и сумма
  // цифр этого не видит. Теперь берём вероятность: для каждой соседней цифры это
  // (её шипы минус уже найденные) / (её незакрытые непомеченные соседи), и из них берём худшую -
  // пессимистично. Клетке без соседних цифр ставим DEFAULT_RISK.
  const risk = ([r, c]) => {
    let worst = -1;
    for (const [dr, dc, v] of around(r, c)) {
      if (!/^[0-9]$/.test(v)) continue;
      const nb = around(dr, dc).filter(([, , x]) => x === '*');
      const open = nb.filter(([rr, cc]) => !thorns.has(key(rr, cc)));
      if (!open.length) continue;
      const left = Number(v) - (nb.length - open.length);
      worst = Math.max(worst, left / open.length);
    }
    return worst < 0 ? DEFAULT_RISK : worst;
  };
  return { safe, thorns, unknown, score: risk, key };
}

function pickGridCell(rows) {
  const { safe, thorns, unknown, score, key } = solveGrid(rows);
  const free = unknown.filter(([r, c]) => !thorns.has(key(r, c)));
  const pool = safe.length ? safe : (free.length ? free : unknown);
  if (!pool.length) return { pick: null, safeCount: safe.length, thornCount: thorns.size };
  const best = Math.min(...pool.map(score));
  const cands = pool.filter((x) => score(x) === best);
  return { pick: cands[Math.floor(Math.random() * cands.length)], safeCount: safe.length, thornCount: thorns.size };
}

// Номер закрытой клетки в порядке чтения - он же номер ссылки-клетки на экране.
function gridCellIndex(rows, r, c) {
  let idx = 0;
  for (let rr = 0; rr < rows.length; rr++) {
    for (let cc = 0; cc < rows[rr].length; cc++) {
      if (rr === r && cc === c) return rows[rr][cc] === '*' ? idx : -1;
      if (rows[rr][cc] === '*') idx += 1;
    }
  }
  return -1;
}
