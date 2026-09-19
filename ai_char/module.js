// Scenario: Daily Quests
//
// Раньше весь код жил в этом файле (~10.5 тыс. строк). 19.09.2026 разрезан по темам в ai_char/lib/,
// поведение не менялось. Здесь только сборка экспорта - driver.js и остальные делают
// require('./module') как раньше и получают те же имена.
//
// Правила для lib/:
// - Изменяемое состояние верхнего уровня (бывшие `let` - счётчики дней, lastKnownHp и т.д.)
//   живёт ТОЛЬКО в lib/state.js как поля объекта S: читать и писать S.имя. В CommonJS нет
//   live-binding, поэтому `let` в одном файле и копия в другом разошлись бы молча.
// - Файлы lib/ вызывают друг друга по кругу. Поэтому каждый файл (кроме state.js) ставит
//   `module.exports = { функции }` в САМОМ НАЧАЛЕ, до своих require: функции всплывают, и
//   встречный require получает их сразу. Константы так не работают (до своей строки их нет),
//   поэтому константы, нужные другим файлам, лежат в state.js - он ни от кого не зависит.
// - lib/ никогда не требует ../module.
//
// Карта файлов:
//   lib/state.js                   Общее состояние бота: настройки, счётчики дней, persisted state (daily_quests_piraty.state.json).
//   lib/core.js                    Базовые помощники: паузы, getBodyText, parseStats, планирование следующего цикла, debug-снимки.
//   lib/daily_quests.js            Диспетчер дневных квестов (runDailyQuests), проверки "можно ли сейчас", hasPendingFightQuests.
//   lib/mail.js                    Почта: счётчик писем, чтение/ответ на письма, emit-сообщения драйверу (MAIL/PVP/CHAT_TRIGGER), личные письма.
//   lib/quest_menu.js              Q-меню квестов: открыть, "Информация" по квесту, текущее задание/отказ, разбор списка квестов.
//   lib/tavern.js                  Квест "Харчевня".
//   lib/hp.js                      HP-гейты перед боями, runQuestStepSafe, чтение HP/резерва, ожидание HP.
//   lib/quests_basic.js            Простые дневные квесты: Дерево жизни, Рыбий глаз, Камни Драбаса, Кузница Рума, Еда для рыбака, Грабим корованы, Довольствие.
//   lib/shtolni.js                 Квест "Штольни" (выключен для AI__, см. SHTOLNI_ENABLED_FOR_AI).
//   lib/stats_decisions.js         Решения по статам (shouldXByStats) + закомментированный старый квест УГО.
//   lib/pvp.js                     PvP: детект нападений, скриншоты, оповещения, бой с нападающим.
//   lib/ui.js                      Клики и шаги по интерфейсу: селекторы, clickByTexts*, existsAnyText, performStep.
//   lib/farm_goblins_blake.js      Фарм гоблинов и Блейка (маршруты и вход в бой).
//   lib/recovery.js                Восстановление: fastway-переходы, лечебная экипировка/эликсиры, эли, Последний дом, чтение статов на локации.
//   lib/fight.js                   Цикл боя fightLoop.
//   lib/vinograd_statue.js         Полив винограда и Статуя Славы.
//   lib/fishing.js                 Рыбалка и кухня (жарка рыбы в доме, Кулак Хаоса).
//   lib/scenario.js                Главный сценарий цикла doScenario.
//   lib/assassins.js               Гильдия асассинов (банкир/картина/торговец).
//   lib/quests_story.js            Галерея/лазулиты, Демон озера, Ордо экзекуторс, Кораблекрушение, сбор трав.
//   lib/fish_restaurant_quest.js   Квест "Рыбный ресторан Тёща Кумуса" (выключен, см. FISH_RESTAURANT_ENABLED).
//   lib/weekday_dailies.js         Дейлики по дням недели: четверг в Мисттоуне, охоты Ср/Пт, выход из зависших сцен.
//   lib/farm.js                    Фарм: подвалы, гарпия, бизон, кабан.
//   lib/chat.js                    Чат: чтение, разбор сообщений, триггеры, мониторинг комнат, раса/фракция игрока.
//   lib/shepot.js                  Ежемесячный квест "Шепот".

require('playwright'); // module.js всегда грузил playwright первым - порядок загрузки сохранён.

const { AI_SELF_NICK } = require('./lib/state');
const { fixedPause, getBodyText, parseStats, pause, saveSnapshot } = require('./lib/core');
const { hasPendingFightQuests, runDailyQuests } = require('./lib/daily_quests');
const {
  emitChatTrigger, handleUnreadMailIfAny, replyToLetter, sendPrivateLetter,
} = require('./lib/mail');
const {
  clickInfoForQuest, dropCurrentAssignment, hasAlreadyHasQuestText, readCurrentAssignment,
  resetToQuestMenu,
} = require('./lib/quest_menu');
const { ensureTavernQuestTurnedIn } = require('./lib/tavern');
const { waitForHpAbove } = require('./lib/hp');
const {
  progressFisherFoodQuest, progressLifeTreeQuest, runDovolstvieIfAvailable, runFishEyeIfDue,
} = require('./lib/quests_basic');
require('./lib/shtolni');
require('./lib/stats_decisions');
const { handleIncomingAttackIfAny } = require('./lib/pvp');
const { clickByTexts, clickOnlySensibleOption, existsAnyText } = require('./lib/ui');
require('./lib/farm_goblins_blake');
const {
  ensureBuffAlesActive, ensureHealingGearEquipped, goToChaosByAmulet, goToLocationAndReadStats,
  isAnyBuffAleActive, recoverToCity,
} = require('./lib/recovery');
const { fightLoop } = require('./lib/fight');
const {
  runStatueOfGloryIfDue, runStatueOfGloryTask, scheduleNextStatueOfGlory,
} = require('./lib/vinograd_statue');
const { fryFishWhileHealing, runFishingIfDue } = require('./lib/fishing');
const { doScenario } = require('./lib/scenario');
const { runAssassinGuildQuestsIfAvailable } = require('./lib/assassins');
const {
  runDemonLakeQuestIfAvailable, runGalleryQuestIfAvailable, runHerbQuestsIfAvailable,
  runOrdoQuestsIfAvailable, runShipwreckQuestIfAvailable,
} = require('./lib/quests_story');
const { runFishRestaurantQuestIfAvailable } = require('./lib/fish_restaurant_quest');
const {
  escapeStuckSceneIfAny, readDailyTasksProgress, resolvePendingFightIfAny,
  runThursdayDailiesIfAvailable, runWeekdayHuntsIfDue,
} = require('./lib/weekday_dailies');
const {
  runBisonFarmRound, runBoarFarmRound, runHarpyFarmRound, runPodvalyFarmRound,
} = require('./lib/farm');
const {
  CHAT_ROOMS, chatMessageAgeMinutes, detectChatTriggers, extractChatMessagesSection,
  getPlayerRaceAndFaction, getRecentChatMessages, parseChatMessages, postChatMessage,
  runChatMonitorCycle,
} = require('./lib/chat');
const { runShepotQuestIfAvailable } = require('./lib/shepot');

module.exports = {
  doScenario,
  parseStats,
  getBodyText,
  pause,
  fixedPause,
  handleUnreadMailIfAny,
  recoverToCity,
  saveSnapshot,
  goToLocationAndReadStats,
  fightLoop,
  clickByTexts,
  runDailyQuests,
  goToChaosByAmulet,
  progressLifeTreeQuest,
  progressFisherFoodQuest,
  resetToQuestMenu,
  clickInfoForQuest,
  existsAnyText,
  runAssassinGuildQuestsIfAvailable,
  runGalleryQuestIfAvailable,
  runFishEyeIfDue,
  runPodvalyFarmRound,
  runHarpyFarmRound,
  runBisonFarmRound,
  runBoarFarmRound,
  runDemonLakeQuestIfAvailable,
  runShipwreckQuestIfAvailable,
  runFishRestaurantQuestIfAvailable,
  handleIncomingAttackIfAny,
  ensureHealingGearEquipped,
  replyToLetter,
  ensureBuffAlesActive,
  isAnyBuffAleActive,
  runHerbQuestsIfAvailable,
  runThursdayDailiesIfAvailable,
  runWeekdayHuntsIfDue,
  hasPendingFightQuests,
  resolvePendingFightIfAny,
  runFishingIfDue,
  fryFishWhileHealing,
  runOrdoQuestsIfAvailable,
  escapeStuckSceneIfAny,
  readDailyTasksProgress,
  getPlayerRaceAndFaction,
  postChatMessage,
  getRecentChatMessages,
  extractChatMessagesSection,
  parseChatMessages,
  detectChatTriggers,
  chatMessageAgeMinutes,
  emitChatTrigger,
  AI_SELF_NICK,
  sendPrivateLetter,
  CHAT_ROOMS,
  runChatMonitorCycle,
  runStatueOfGloryIfDue,
  runStatueOfGloryTask,
  ensureTavernQuestTurnedIn,
  resetToQuestMenu,
  fightLoop,
  clickByTexts,
  fixedPause,
  scheduleNextStatueOfGlory,
  waitForHpAbove,
  clickOnlySensibleOption,
  runShepotQuestIfAvailable,
  readCurrentAssignment,
  dropCurrentAssignment,
  hasAlreadyHasQuestText,
  runDovolstvieIfAvailable,
};
