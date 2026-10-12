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
  const safe = [];
  for (const [r, c, d] of digits) {
    const nb = around(r, c).filter(([, , v]) => v === '*');
    const known = nb.filter(([rr, cc]) => thorns.has(key(rr, cc))).length;
    if (d - known === 0) {
      for (const [rr, cc] of nb) {
        if (!thorns.has(key(rr, cc)) && !safe.some(([sr, sc]) => sr === rr && sc === cc)) safe.push([rr, cc]);
      }
    }
  }
  const score = ([r, c]) => around(r, c).reduce((a, [, , v]) => a + (/^[0-9]$/.test(v) ? Number(v) : 0), 0);
  return { safe, thorns, unknown, score, key };
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
