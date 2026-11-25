// Google Apps Script для таблицы «Еда на неделю — пользователи».
// Таблица → Расширения → Apps Script → вставить этот код → Начать развёртывание →
// Новое развёртывание → Веб-приложение, «Запуск от имени: я», «Доступ: все» → скопировать URL.
// URL вписать в Worker как переменную SHEET_URL.
// Лист «События» — каждое действие строкой. Лист «Пользователи» — одна строка на человека.

const EV = ["Время", "ID", "Имя", "Username", "Язык", "Событие", "Новый", "Цель", "Бюджет", "Человек", "Данные"];
const US = ["ID", "Имя", "Username", "Язык", "Первый визит", "Последний визит", "Меню собрано", "Цель", "Бюджет", "Человек", "Действий"];

function sheet_(name, head) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(name);
  if (!sh) { sh = ss.insertSheet(name); sh.appendRow(head); sh.setFrozenRows(1); sh.getRange(1, 1, 1, head.length).setFontWeight("bold"); }
  return sh;
}

function doPost(e) {
  const d = JSON.parse(e.postData.contents);
  const lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    const user = d.username ? "@" + d.username : "";
    sheet_("События", EV).appendRow([d.time, d.id, d.name, user, d.lang, d.ev, d.isNew ? "да" : "", d.goal, d.budget, d.people, d.data]);
    const us = sheet_("Пользователи", US), ids = us.getRange(1, 1, Math.max(us.getLastRow(), 1), 1).getValues().map(r => String(r[0]));
    const i = ids.indexOf(String(d.id));
    if (i < 0) us.appendRow([d.id, d.name, user, d.lang, d.first, d.time, d.plans, d.goal, d.budget, d.people, 1]);
    else {
      const row = i + 1, n = +us.getRange(row, 11).getValue() || 0;
      us.getRange(row, 2, 1, 10).setValues([[d.name, user, d.lang, us.getRange(row, 5).getValue() || d.first, d.time, d.plans, d.goal, d.budget, d.people, n + 1]]);
    }
  } finally { lock.releaseLock(); }
  return ContentService.createTextOutput("ok");
}
