// ИССЛЕДОВАТЕЛЬ КВЕСТА: первый проход незнакомого квеста живьём, с записью маршрута.
//
// Зачем. 28.09.2026 Паша: «выработай механику прохождения квестов в первый раз. Полдня у тебя ушло
// на 2 квеста». Полдня ушло потому, что я угадывал экраны по одному за заход: правка файла ->
// заход драйвера -> срыв -> пауза 15 минут -> снова правка. Один неизвестный экран стоил 5-15 минут.
// Здесь наоборот: ОДИН живой проход, каждый экран печатается, решения принимаются на месте, а
// пройденные шаги пишутся в <квест>.steps.draft - готовый черновик маршрута для guide_run.
//
// ЗАПУСК (драйвер ДОЛЖЕН быть остановлен: профиль Chrome один на всех):
//   node guides/explore.js "Магическая башня" [--max 60] [--hints файл] [--no-fight]
//   --hints  файл с ожидаемыми репликами по гайду Кейт, по одной в строке: из них выбираются ветки.
//   --no-fight  до боёв не доходить, остановиться и показать экран.
//
// Правила, все выстраданы живьём:
//   * служебные ссылки не трогает; «Уйти», «Отказаться», «Повернуть обратно», «Вернуться» - никогда;
//   * бой только при HP >= 90% и через fightLoop; после боя ищет «Продолжить квест»;
//   * ссылка, которая осталась на экране после клика, а HP упало, - это рандомный прыжок
//     (механику объяснил Паша про Магическую башню): ждёт минуту и повторяет;
//   * «Запрет на квесты N мин», «нужно отдохнуть N мин», «устали и решили отдохнуть» - пережидает;
//   * развилка (несколько сюжетных ссылок) - берёт подсказку из --hints, иначе первую, но пишет
//     «ВЕТКА:» со всеми вариантами и в лог, и в черновик, чтобы человек мог поправить;
//   * слот задания освобождает сам: пока висит «ответственное задание», чужие сцены отвечают
//     «Вы выполняете другую миссию» - на этом я потерял целый день 28.09.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const m = require('../module');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (s) => String(s || '').replace(/^[\s\u00BB*\u2022-]+/, '').replace(/[\u00AB\u00BB"'.,!?\u2026:;()]/g, '').replace(/\u0451/g, 'е').replace(/\s+/g, ' ').trim().toLowerCase();
const SERVICE_RE = /^(обновить|чат|в игру|кто здесь\?|выход|размер текста|амулет|aмулет|конь|карта|форум|кланы|жг|галерея|настройка)$|^бои|^ai__|^q\d+$|^d\d+$|^памятник|^стела|^мемориал$/i;
const NEVER_RE = /^(уйти|отказаться|повернуть обратно|вернуться|назад)$/i;
const FIGHT_RE = /^(в бой!?|принять бой!?|напасть)/i;

function parseArgs() {
  const a = process.argv.slice(2);
  const out = { name: a[0], max: 60, hints: null, noFight: false };
  for (let i = 1; i < a.length; i += 1) {
    if (a[i] === '--max') out.max = Number(a[i + 1] || 60), i += 1;
    else if (a[i] === '--hints') out.hints = a[i + 1], i += 1;
    else if (a[i] === '--no-fight') out.noFight = true;
  }
  return out;
}

(async () => {
  const opt = parseArgs();
  if (!opt.name) {
    console.log('Укажи название квеста: node guides/explore.js "Магическая башня"');
    process.exit(1);
  }
  const hints = opt.hints ? fs.readFileSync(opt.hints, 'utf8').split(/\r?\n/).map((x) => x.trim()).filter(Boolean) : [];
  const slug = opt.name.replace(/[^0-9A-Za-zА-Яа-яЁё]+/g, '_').toLowerCase();
  const draftPath = path.join(__dirname, slug + '.steps.draft');
  const draft = [
    '# Черновик маршрута «' + opt.name + '», снят исследователем ' + new Date().toLocaleString('ru-RU') + '.',
    '# Проверить строки «ВЕТКА:» (там был выбор) и переименовать в .steps.',
  ];

  const ctx = await chromium.launchPersistentContext('C:/lbast-bot/ai_char/chrome-profile-ai-char', { headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const links = () => page.evaluate(() => Array.from(document.querySelectorAll('a'))
    .map((a) => ({ t: (a.innerText || '').trim(), h: a.getAttribute('href') || '' }))
    .filter((x) => x.t && !/statuenull/i.test(x.h)));
  const go = async (h) => {
    await page.goto('http://lbast.ru/' + String(h).replace(/^\//, ''), { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(800);
  };
  const readHp = async () => {
    const t = await m.getBodyText(page);
    const mm = t.match(/\((-?\d+)\s*\/\s*(\d+)\)/);
    return mm ? { hp: Number(mm[1]), max: Number(mm[2]) } : null;
  };
  const record = (line, comment) => {
    if (comment) draft.push('# ' + comment);
    draft.push(line);
    fs.writeFileSync(draftPath, draft.join('\n') + '\n');
  };
  const backToScene = async () => {
    await go('location.php');
    const cont = (await links()).find((x) => /Продолжить квест/i.test(x.t));
    if (cont) await go(cont.h);
  };

  // 1) Слот задания: пока он занят, чужая сцена отвечает «Вы выполняете другую миссию».
  await go('pers.php');
  const dropHref = await page.evaluate(() => {
    const a = Array.from(document.querySelectorAll('a')).find((x) => (x.getAttribute('href') || '').includes('mod=dropquest'));
    return a ? a.getAttribute('href') : null;
  });
  if (dropHref) {
    await go(dropHref);
    console.log('Слот задания: висевшее задание снято.');
  } else {
    console.log('Слот задания: свободен.');
  }

  // 2) Берём квест: Q -> [инфо] -> «К месту выполнения» (игра сама приводит в нужную точку).
  await m.resetToQuestMenu(page).catch(() => false);
  const infoOk = await m.clickInfoForQuest(page, opt.name).catch(() => false);
  console.log('Инфо квеста открыто:', infoOk);
  const goPlace = (await links()).find((x) => /^К месту выполнения$/i.test(x.t));
  if (goPlace) {
    await go(goPlace.h);
    await sleep(6000);
    await go('location.php');
    for (let i = 0; i < 25; i += 1) {
      const t = await m.getBodyText(page);
      if (!/В пути|осталось\s+\d+/i.test(t)) break;
      await sleep(6000);
      await go('location.php');
    }
    record('@qinfo ' + opt.name, 'взятие квеста и дорога к месту выполнения');
  }

  let fights = 0;
  for (let step = 1; step <= opt.max; step += 1) {
    let body = await m.getBodyText(page);
    // Пережидаем игровые паузы.
    for (let w = 0; w < 4; w += 1) {
      const ban = body.match(/Запрет на квесты\s+(\d+)\s*мин/i)
        || body.match(/нужно отдохнуть еще\s+(\d+)\s*мин/i)
        || body.match(/устали и решили отдохнуть\s+(\d+)\s*мин/i);
      if (!ban) break;
      console.log('Пауза игры: ' + ban[1] + ' мин - жду.');
      await sleep((Number(ban[1]) * 60 + 25) * 1000);
      await backToScene();
      body = await m.getBodyText(page);
    }
    const scene = (await links()).filter((x) => !SERVICE_RE.test(x.t) && !NEVER_RE.test(x.t));
    console.log('\n=== ЭКРАН ' + step + ' ===\n' + body.replace(/\n\s*\n+/g, '\n').slice(0, 700));
    console.log('ВАРИАНТЫ: ' + scene.map((x) => x.t).join(' | '));

    if (/Задание завершено/i.test(body)) {
      console.log('*** КВЕСТ ПРОЙДЕН, боёв ' + fights + ' ***');
      record('?Задание завершено');
      break;
    }

    const fightLink = scene.find((x) => FIGHT_RE.test(x.t));
    if (fightLink || /Ударить/.test(body)) {
      if (opt.noFight) { console.log('--no-fight: дальше бой, останавливаюсь.'); break; }
      const s = await readHp();
      record('@heal 0.95', 'лечение ПЕРЕД входом в бой');
      if (s && s.max && s.hp < s.max * 0.9) {
        console.log('HP ' + s.hp + '/' + s.max + ' - жду лечения до 95%.');
        for (let k = 0; k < 40; k += 1) {
          const c = await readHp();
          if (c && c.hp >= c.max * 0.95) break;
          await sleep(60000);
        }
        await backToScene();
      }
      if (fightLink) await go(fightLink.h);
      const won = await m.fightLoop(page).catch((e) => { console.log('fightLoop error', e.message); return null; });
      fights += 1;
      const after = await readHp();
      console.log('>>> бой ' + fights + ': ' + won + ', HP ' + (after ? after.hp + '/' + after.max : '?'));
      record('@fight', 'бой ' + fights + ': HP после ' + (after ? after.hp + '/' + after.max : '?'));
      if (after && after.hp <= 0) { console.log('Бой ПРОИГРАН - останавливаюсь, дальше решает человек.'); break; }
      await backToScene();
      continue;
    }

    if (!scene.length) { console.log('СТОП: сюжетных ссылок нет.'); break; }

    const hinted = hints.find((h) => scene.some((x) => norm(x.t).startsWith(norm(h))));
    let pick = hinted ? scene.find((x) => norm(x.t).startsWith(norm(hinted))) : null;
    let branch = null;
    if (!pick) {
      if (scene.length === 1) pick = scene[0];
      else { pick = scene[0]; branch = scene.map((x) => x.t).join(' | '); }
    }
    console.log('жму: ' + pick.t + (branch ? '   (ВЕТКА)' : ''));
    const before = await readHp();
    await go(pick.h);
    const now = await readHp();
    const stillThere = (await links()).some((x) => norm(x.t) === norm(pick.t));
    if (stillThere && before && now && now.hp < before.hp) {
      console.log('Рандомный прыжок: HP ' + before.hp + ' -> ' + now.hp + ', ссылка осталась. Повторяю раз в минуту.');
      record('@jump ' + pick.t, 'рандом: при неудаче HP в минус, повтор через минуту');
      for (let k = 1; k <= 25; k += 1) {
        await sleep(65000);
        await backToScene();
        const again = (await links()).find((x) => norm(x.t) === norm(pick.t));
        if (!again) { console.log('Прыжок удался (ссылки больше нет), попыток ' + k + '.'); break; }
        await go(again.h);
        if (!(await links()).some((x) => norm(x.t) === norm(pick.t))) { console.log('Прыжок удался с попытки ' + (k + 1) + '.'); break; }
      }
      continue;
    }
    record(pick.t, branch ? 'ВЕТКА: ' + branch : null);
  }
  console.log('\nЧерновик маршрута: ' + draftPath);
  await ctx.close();
})();
