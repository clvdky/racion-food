// Сервер бота «Еда на неделю» для Cloudflare Workers.
// Переменные окружения:
//   BOT_TOKEN  — токен бота из @BotFather (секрет, вводится в настройках Worker)
//   APP_URL    — ссылка на Mini App (по умолчанию GitHub Pages)
//   ADMIN_CODE — секрет: админ один раз пишет боту /admin <код>
//   SHEET_URL  — необязательно: адрес веб-приложения Google Apps Script (server/sheets.gs),
//                туда дублируется каждое событие
// Привязки:
//   USERS      — KV namespace: подписки (r:), пользователи (u:), цены (p:), настройки (cfg:)
// Триггеры Cron: "0 6 * * SUN" — напоминание в воскресенье 11:00 по Алматы;
//                 "*/20 * * * *" — шаг обновления цен (полный круг ≈ 2 часа).
// Цены: GET /prices — для Mini App; правила сопоставления берутся из APP_URL/match.json.
// После деплоя один раз открыть https://<worker>.workers.dev/setup

const DEFAULT_APP = "https://clvdky.github.io/racion-food/";

const T = {
  start: (name) =>
    `Привет${name ? ", " + name : ""}!\n\n` +
    "Я помогу питаться вкусно и недорого:\n" +
    "• меню на 7 дней под твою цель, бюджет и посуду\n" +
    "• пошаговые рецепты с таймером\n" +
    "• список покупок с ценами Magnum и Small\n" +
    "• сколько экономишь по сравнению с кафе\n\n" +
    "Всё бесплатно. Нажми кнопку ниже — займёт 2 минуты.",
  help:
    "Что умею:\n" +
    "/start — открыть приложение\n" +
    "/menu — моё меню на неделю\n" +
    "/remind — напоминания о закупке по воскресеньям\n" +
    "/help — эта справка\n\n" +
    "Меню, список покупок и рецепты — в приложении по кнопке «Открыть рацион» внизу чата.",
  remindOn: "Готово! Каждое воскресенье в 11:00 напомню собрать меню и закупиться. Отключить — /remind",
  remindOff: "Напоминания выключены. Включить снова — /remind",
  weekly:
    "Воскресенье — лучший день, чтобы закупиться на неделю.\n\n" +
    "Открой приложение: нажми «Начать новую неделю» — остатки продуктов учтутся, — и отправь себе список покупок.",
  other: "Я отвечаю на команды. Всё главное — в приложении.",
};

const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });

async function tg(env, method, body) {
  const r = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return r.json();
}

// Секрет вебхука выводится из токена — отдельную переменную заводить не нужно
async function hookSecret(env) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("racion:" + env.BOT_TOKEN));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 48);
}

const appUrl = (env) => env.APP_URL || DEFAULT_APP;
const appButton = (env, text = "Открыть рацион") => ({ inline_keyboard: [[{ text, web_app: { url: appUrl(env) } }]] });

async function isSubscribed(env, chatId) {
  return env.USERS ? (await env.USERS.get("r:" + chatId)) !== null : false;
}

async function startKeyboard(env, chatId) {
  const sub = await isSubscribed(env, chatId);
  return {
    inline_keyboard: [
      [{ text: "Открыть рацион", web_app: { url: appUrl(env) } }],
      [{ text: sub ? "Выключить напоминания" : "Напоминать по воскресеньям", callback_data: sub ? "remind_off" : "remind_on" }],
    ],
  };
}

async function setRemind(env, chatId, on, user) {
  if (!env.USERS) return;
  if (on) await env.USERS.put("r:" + chatId, JSON.stringify({ name: user?.first_name || "", t: Date.now() }));
  else await env.USERS.delete("r:" + chatId);
}


// ---------- Пользователи, события, админ ----------
const hex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
const almaty = (t) => new Date(t + 5 * 3600e3).toISOString().slice(0, 16).replace("T", " ");
const GOAL = { lose: "похудеть", keep: "держать вес", gain: "набрать" };
const EVN = { open: "открыл приложение", plan: "собрал меню", share: "поделился списком" };

async function checkInit(env, initData) {   // проверка подписи Telegram Mini App
  const p = new URLSearchParams(initData || ""), hash = p.get("hash");
  if (!hash) return null;
  p.delete("hash");
  const dcs = [...p.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => k + "=" + v).join("\n");
  const enc = new TextEncoder(), alg = { name: "HMAC", hash: "SHA-256" };
  const k1 = await crypto.subtle.importKey("raw", enc.encode("WebAppData"), alg, false, ["sign"]);
  const k2 = await crypto.subtle.importKey("raw", await crypto.subtle.sign("HMAC", k1, enc.encode(env.BOT_TOKEN)), alg, false, ["sign"]);
  if (hex(await crypto.subtle.sign("HMAC", k2, enc.encode(dcs))) !== hash) return null;
  if (Date.now() / 1000 - +p.get("auth_date") > 7 * 86400) return null;
  try { return JSON.parse(p.get("user")); } catch (e) { return null; }
}

const getCfg = (env) => kvGet(env, "cfg:admin", { ids: [], notify: true });
const isAdmin = async (env, id) => (await getCfg(env)).ids.includes(id);
const who = (u) => [u.name, u.last].filter(Boolean).join(" ") + (u.username ? " @" + u.username : "") + " (id " + u.id + ")";

// Записать событие: обновляет карточку u:<id>, шлёт уведомление админу и строку в Google Sheets
async function logEvent(env, from, ev, data = {}) {
  if (!env.USERS || !from || !from.id || from.is_bot) return;
  const now = Date.now(), key = "u:" + from.id;
  const old = await kvGet(env, key, null), isNew = !old;
  const u = old || { id: from.id, first: now, n: 0, plans: 0, events: [], src: data.start || "" };
  if (!isNew && ev === "open" && now - u.seen < 10 * 60e3) return;   // не пишем каждое открытие
  Object.assign(u, { name: from.first_name || "", last: from.last_name || "", username: from.username || "", lang: from.language_code || "", premium: !!from.is_premium, seen: now });
  u.n++;
  if (!u.src && data.start) u.src = data.start;
  if (data.goal) u.profile = { goal: data.goal, budget: data.budget, people: data.people, time: data.time, meals: data.meals };
  const firstPlan = ev === "plan" && !u.plans;
  if (ev === "plan") u.plans++;
  u.events = [{ t: now, ev }].concat(u.events).slice(0, 30);
  const meta = { n: (u.name + " " + u.last).trim().slice(0, 60), u: u.username, f: u.first, s: u.seen, c: u.n, p: u.plans, g: u.profile?.goal || "", b: u.profile?.budget || 0 };
  await env.USERS.put(key, JSON.stringify(u), { metadata: meta });

  const cfg = await getCfg(env);
  if (cfg.notify && cfg.ids.length && !cfg.ids.includes(from.id) && (isNew || firstPlan)) {
    let t = isNew ? "Новый пользователь\n" + who(u) + "\nЯзык: " + (u.lang || "—") + (u.src ? "\nИсточник: " + u.src : "") + "\nПервое действие: " + (EVN[ev] || ev)
                  : "Собрал первое меню\n" + who(u);
    if (ev === "plan" && data.goal) t += "\nЦель: " + (GOAL[data.goal] || data.goal) + ", " + data.people + " чел., бюджет " + data.budget + " ₸, меню " + data.cost + " ₸";
    for (const id of cfg.ids) await tg(env, "sendMessage", { chat_id: id, text: t, disable_web_page_preview: true });
  }
  if (env.SHEET_URL) {
    try {
      await fetch(env.SHEET_URL, { method: "POST", headers: { "content-type": "application/json" }, redirect: "follow",
        body: JSON.stringify({ time: almaty(now), id: u.id, name: (u.name + " " + u.last).trim(), username: u.username, lang: u.lang, ev, isNew,
          goal: u.profile?.goal || "", budget: u.profile?.budget || "", people: u.profile?.people || "", plans: u.plans, first: almaty(u.first), data: JSON.stringify(data) }) });
    } catch (e) { console.log("sheet", e); }
  }
}

async function listUsers(env) {
  const out = []; let c;
  do { const p = await env.USERS.list({ prefix: "u:", cursor: c }); for (const k of p.keys) out.push({ id: +k.name.slice(2), ...(k.metadata || {}) }); c = p.list_complete ? null : p.cursor; } while (c);
  return out;
}

async function adminCmd(env, chatId, cmd, arg) {
  const send = (text) => tg(env, "sendMessage", { chat_id: chatId, text, disable_web_page_preview: true });
  if (cmd === "/stats") {
    const L = await listUsers(env), now = Date.now(), d = 86400e3;
    const cnt = (f) => L.filter(f).length;
    let subs = 0, c; do { const p = await env.USERS.list({ prefix: "r:", cursor: c }); subs += p.keys.length; c = p.list_complete ? null : p.cursor; } while (c);
    const g = {}; for (const u of L) if (u.g) g[u.g] = (g[u.g] || 0) + 1;
    return send("Пользователи: " + L.length +
      "\nНовых за сутки: " + cnt((u) => now - u.f < d) + ", за 7 дней: " + cnt((u) => now - u.f < 7 * d) +
      "\nАктивных за сутки: " + cnt((u) => now - u.s < d) + ", за 7 дней: " + cnt((u) => now - u.s < 7 * d) +
      "\nСобрали меню: " + cnt((u) => u.p > 0) +
      "\nПодписаны на напоминания: " + subs +
      "\nЦели: " + (Object.entries(g).map(([k, v]) => (GOAL[k] || k) + " " + v).join(", ") || "—"));
  }
  if (cmd === "/users") {
    const L = (await listUsers(env)).sort((a, b) => b.s - a.s).slice(0, 25);
    if (!L.length) return send("Пока никого.");
    return send("Последние активные:\n\n" + L.map((u) => almaty(u.s) + "  " + (u.n || "без имени") + (u.u ? " @" + u.u : "") + "  · меню: " + (u.p || 0)).join("\n"));
  }
  if (cmd === "/export") {
    const L = await listUsers(env), q = (v) => '"' + String(v ?? "").replace(/"/g, '""') + '"';
    const rows = [["id", "имя", "username", "первый визит", "последний визит", "действий", "меню собрано", "цель", "бюджет"]]
      .concat(L.map((u) => [u.id, u.n, u.u ? "@" + u.u : "", almaty(u.f), almaty(u.s), u.c, u.p, GOAL[u.g] || "", u.b || ""]));
    const fd = new FormData();
    fd.append("chat_id", String(chatId));
    fd.append("document", new Blob(["﻿" + rows.map((r) => r.map(q).join(";")).join("\n")], { type: "text/csv" }), "users-" + almaty(Date.now()).slice(0, 10) + ".csv");
    return fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendDocument`, { method: "POST", body: fd });
  }
  if (cmd === "/notify") {
    const cfg = await getCfg(env); cfg.notify = !cfg.notify;
    await env.USERS.put("cfg:admin", JSON.stringify(cfg));
    return send(cfg.notify ? "Уведомления о новых пользователях включены." : "Уведомления выключены. Включить — /notify");
  }
  return send("Админ-команды:\n/stats — сводка\n/users — последние активные\n/export — все пользователи в CSV (открывается в Excel и Google Sheets)\n/notify — вкл/выкл уведомления");
}

async function onMessage(env, msg) {
  const chatId = msg.chat.id, text = (msg.text || "").trim();
  if (msg.chat.type !== "private") return; // в группах молчим
  const cmd = text.split(/[ @]/)[0].toLowerCase(), arg = text.split(/\s+/)[1] || "";
  await logEvent(env, msg.from, cmd.startsWith("/") ? "bot " + cmd : "bot text", cmd === "/start" && arg ? { start: arg } : {});
  if (cmd === "/admin" && env.ADMIN_CODE && arg === env.ADMIN_CODE) {
    const cfg = await getCfg(env);
    if (!cfg.ids.includes(msg.from.id)) cfg.ids.push(msg.from.id);
    await env.USERS.put("cfg:admin", JSON.stringify(cfg));
    return adminCmd(env, chatId, "/help-admin");
  }
  if (["/stats", "/users", "/export", "/notify", "/admin"].includes(cmd) && (await isAdmin(env, msg.from.id))) return adminCmd(env, chatId, cmd, arg);
  if (cmd === "/start") {
    return tg(env, "sendMessage", { chat_id: chatId, text: T.start(msg.from?.first_name), reply_markup: await startKeyboard(env, chatId) });
  }
  if (cmd === "/menu") return tg(env, "sendMessage", { chat_id: chatId, text: "Твоё меню, покупки и рецепты — по кнопке ниже.", reply_markup: appButton(env) });
  if (cmd === "/help") return tg(env, "sendMessage", { chat_id: chatId, text: T.help, reply_markup: appButton(env) });
  if (cmd === "/remind") {
    const on = !(await isSubscribed(env, chatId));
    await setRemind(env, chatId, on, msg.from);
    return tg(env, "sendMessage", { chat_id: chatId, text: on ? T.remindOn : T.remindOff });
  }
  return tg(env, "sendMessage", { chat_id: chatId, text: T.other, reply_markup: appButton(env) });
}

async function onCallback(env, cq) {
  const chatId = cq.message?.chat.id;
  await logEvent(env, cq.from, "bot " + cq.data);
  if (cq.data === "remind_on" || cq.data === "remind_off") {
    const on = cq.data === "remind_on";
    await setRemind(env, chatId, on, cq.from);
    await tg(env, "answerCallbackQuery", { callback_query_id: cq.id, text: on ? "Напоминания включены" : "Напоминания выключены" });
    if (cq.message) await tg(env, "editMessageReplyMarkup", { chat_id: chatId, message_id: cq.message.message_id, reply_markup: await startKeyboard(env, chatId) });
    return;
  }
  return tg(env, "answerCallbackQuery", { callback_query_id: cq.id });
}

async function setup(env, origin) {
  const secret = await hookSecret(env);
  const res = {};
  res.webhook = await tg(env, "setWebhook", {
    url: origin + "/webhook", secret_token: secret, allowed_updates: ["message", "callback_query"], drop_pending_updates: true,
  });
  res.commands = await tg(env, "setMyCommands", {
    commands: [
      { command: "start", description: "Открыть рацион" },
      { command: "menu", description: "Моё меню на неделю" },
      { command: "remind", description: "Напоминания о закупке" },
      { command: "help", description: "Что умеет бот" },
    ],
  });
  res.menuButton = await tg(env, "setChatMenuButton", { menu_button: { type: "web_app", text: "Открыть рацион", web_app: { url: appUrl(env) } } });
  res.kv = !!env.USERS;
  return res;
}

async function weekly(env) {
  if (!env.USERS) return 0;
  let cursor, sent = 0;
  do {
    const page = await env.USERS.list({ prefix: "r:", cursor });
    for (const k of page.keys) {
      const chatId = k.name.slice(2);
      const r = await tg(env, "sendMessage", { chat_id: chatId, text: T.weekly, reply_markup: appButton(env, "Собрать меню и список") });
      if (r.ok) sent++;
      else if (r.error_code === 403) await env.USERS.delete(k.name); // пользователь заблокировал бота
      await new Promise((ok) => setTimeout(ok, 40)); // ~25 сообщений/сек — в пределах лимита Telegram
    }
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  return sent;
}


// ================= цены: Magnum (через Kaspi) и Small (через Wolt) =================
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const H = { "User-Agent": UA, "Accept-Language": "ru-RU,ru;q=0.9" };
const KASPI_CITY = "750000000", KASPI_FILTER = ":availableInZones:Magnum_ZONE1", WOLT_VENUE = "smallala50";
// категории Small на Wolt, где есть продукты из рецептов
const WOLT_CATS = [9, 10, 11, 13, 14, 47, 50, 70, 71, 72, 73, 75, 76, 77, 78, 82, 86, 87, 88, 89, 92, 97, 121].map((n) => "menucategory-" + n);
const STEPS = 6; // за сколько запусков проходим все продукты
const norm = (s) => String(s || "").toLowerCase().replace(/ё/g, "е").replace(/ /g, " ");

function parseQty(title, unit) {
  const t = norm(title), re = /(\d+(?:[.,]\d+)?)\s*(кг|гр|г|мл|л|шт)(?![а-я])/g;
  let m;
  while ((m = re.exec(t))) {
    const v = parseFloat(m[1].replace(",", ".")), u = m[2];
    if (!(v > 0)) continue;
    if (unit === "kg") { if (u === "кг") return v; if (u === "г" || u === "гр") return v / 1000; }
    else if (unit === "l") { if (u === "л" || u === "кг") return v; if (u === "мл" || u === "г" || u === "гр") return v / 1000; }
    else if (unit === "pc" && u === "шт") return v;
  }
  if (unit === "kg" && /(^|[\s,(/])кг([\s,)]|$)|весов|за 1 кг/.test(t)) return 1;
  if (unit === "pc" && /десят/.test(t)) return 10;
  return null;
}
const matches = (p, title) => { const t = norm(title); return p.mr.every((r) => r.test(t)) && !(p.er && p.er.test(t)); };
function pickBest(p, items) {   // items: [{title, price, ppu?, url}] -> самая низкая цена за кг / л / шт
  let best = null;
  for (const it of items) {
    if (!it.price || !matches(p, it.title)) continue;
    let ppu = it.ppu;
    if (!ppu) { const q = parseQty(it.title + " " + (it.hint || ""), p.unit); if (!q) continue; ppu = it.price / q; }
    if (p.ref && !(ppu >= p.ref / 3 && ppu <= p.ref * 4)) continue; // не тот товар или неверная фасовка
    if (!best || ppu < best.p) best = { p: Math.round(ppu), t: it.title.slice(0, 90), u: it.url };
  }
  return best;
}
async function kaspiSearch(q, cookie) {
  const u = "https://kaspi.kz/yml/product-view/pl/results?" + new URLSearchParams({ text: q, q: KASPI_FILTER, page: 0, all: "false", fl: "true", ui: "d", i: -1, c: KASPI_CITY, sort: "relevance" });
  const r = await fetch(u, { headers: { ...H, Accept: "application/json, text/*", "X-KS-City": KASPI_CITY, Referer: "https://kaspi.kz/shop/search/?text=" + encodeURIComponent(q), Cookie: cookie } });
  if (!r.ok) throw new Error("kaspi " + r.status);
  const j = await r.json();
  return (j.data || []).map((x) => ({ title: x.title || "", price: x.unitSalePrice || x.unitPrice, url: x.shopLink ? "https://kaspi.kz" + x.shopLink : "" }));
}
async function woltCategory(slug) {
  const out = []; let token = null, guard = 0;
  do {
    const u = `https://consumer-api.wolt.com/consumer-api/consumer-assortment/v1/venues/slug/${WOLT_VENUE}/assortment/categories/slug/${slug}?language=ru` + (token ? "&page_token=" + encodeURIComponent(token) : "");
    const r = await fetch(u, { headers: { ...H, Accept: "application/json" } });
    if (!r.ok) throw new Error("wolt " + r.status);
    const j = await r.json();
    for (const it of j.items || []) {
      if (it.price == null || it.disabled_info) continue;
      const up = it.unit_price, mult = { kilogram: 1, liter: 1, litre: 1, piece: 1 };
      const ppu = up && up.price && mult[up.unit] ? up.price / 100 / (up.base || 1) : it.sell_by_weight_config ? it.price / 100 : null;
      out.push({ title: it.name || "", price: it.price / 100, ppu, hint: it.unit_info || "", url: `https://wolt.com/ru/kaz/almaty/venue/${WOLT_VENUE}/itemid-${it.id}` });
    }
    token = j.metadata && j.metadata.next_page_token;
  } while (token && ++guard < 4);
  return out;
}
const kvGet = async (env, k, d) => { const v = await env.USERS.get(k); return v ? JSON.parse(v) : d; };
const today = () => new Date(Date.now() + 5 * 3600e3).toISOString().slice(0, 16).replace("T", " ");
async function priceStep(env) {
  const st = await kvGet(env, "p:state", { step: 0 }), part = st.step % STEPS, cycle = Math.floor(st.step / STEPS);
  const rules = await (await fetch(appUrl(env) + "match.json", { cf: { cacheTtl: 600 } })).json();
  for (const p of rules) { p.mr = p.must.map((r) => new RegExp(r)); p.er = p.excl ? new RegExp(p.excl) : null; }
  const prices = await kvGet(env, "p:prices", { stores: {} }), log = { step: st.step, part };
  const put = (store, pid, best) => {
    const S = (prices.stores[store] ||= { items: {} }), old = S.items[pid];
    if (best && (!old || old.c !== cycle || best.p < old.p)) S.items[pid] = { ...best, c: cycle };
  };
  // Magnum: треть продуктов за шаг
  try {
    const w = await fetch("https://kaspi.kz/shop/", { headers: H });
    const cookie = (w.headers.getSetCookie ? w.headers.getSetCookie() : []).map((c) => c.split(";")[0]).join("; ");
    const mine = rules.filter((_, i) => i % STEPS === part);
    let ok = 0;
    for (const p of mine) {
      try { const b = pickBest(p, await kaspiSearch(p.q, cookie)); put("magnum", p.id, b); if (b) ok++; } catch (e) { log.kaspiErr = String(e); }
      await new Promise((r) => setTimeout(r, 300));
    }
    log.magnum = ok + "/" + mine.length;
    prices.stores.magnum.updated = today();
  } catch (e) { log.kaspi = String(e); }
  // Small: треть категорий за шаг
  try {
    const cats = WOLT_CATS.filter((_, i) => i % STEPS === part), items = [];
    for (const c of cats) { try { items.push(...(await woltCategory(c))); } catch (e) { log.woltErr = String(e); } await new Promise((r) => setTimeout(r, 200)); }
    let ok = 0;
    for (const p of rules) { const b = pickBest(p, items); if (b) { put("small", p.id, b); ok++; } }
    log.small = ok + " совп. из " + items.length + " товаров";
    (prices.stores.small ||= { items: {} }).updated = today();
  } catch (e) { log.wolt = String(e); }
  // устаревшее (2 круга без подтверждения) убираем
  for (const S of Object.values(prices.stores)) for (const [pid, it] of Object.entries(S.items)) if (cycle - (it.c ?? cycle) > 2) delete S.items[pid];
  prices.at = Date.now();
  await env.USERS.put("p:prices", JSON.stringify(prices));
  await env.USERS.put("p:state", JSON.stringify({ step: st.step + 1, last: Date.now(), log }));
  return log;
}
const cors = { "access-control-allow-origin": "*", "content-type": "application/json; charset=utf-8" };

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (url.pathname === "/track") {   // события из Mini App, подпись initData проверяется
      if (req.method === "OPTIONS") return new Response(null, { headers: { ...cors, "access-control-allow-methods": "POST", "access-control-allow-headers": "content-type" } });
      if (req.method !== "POST" || !env.BOT_TOKEN || !env.USERS) return new Response("{}", { status: 400, headers: cors });
      let b; try { b = JSON.parse(await req.text()); } catch (e) { return new Response("{}", { status: 400, headers: cors }); }
      const user = await checkInit(env, b.initData);
      if (!user) return new Response('{"ok":false}', { status: 403, headers: cors });
      const ev = ["open", "plan", "share"].includes(b.ev) ? b.ev : "other";
      const d = b.data && typeof b.data === "object" ? b.data : {};
      const data = { goal: String(d.goal || "").slice(0, 8), budget: +d.budget || 0, people: +d.people || 0, time: String(d.time || "").slice(0, 5), meals: +d.meals || 0, cost: +d.cost || 0, start: String(d.start || "").slice(0, 64) };
      if (!data.goal) delete data.goal;
      ctx.waitUntil(logEvent(env, user, ev, data).catch((e) => console.log("track", e)));
      return new Response('{"ok":true}', { headers: cors });
    }
    if (url.pathname === "/prices") {
      const p = env.USERS ? await env.USERS.get("p:prices") : null;
      return new Response(p || '{"stores":{}}', { headers: { ...cors, "cache-control": "public, max-age=600" } });
    }
    if (url.pathname === "/prices/status") return new Response(JSON.stringify(await kvGet(env, "p:state", {})), { headers: cors });
    if (url.pathname === "/prices/run") {   // ручной шаг обновления, не чаще раза в 20 секунд
      const st = await kvGet(env, "p:state", {});
      if (st.last && Date.now() - st.last < 20e3) return json({ wait: true });
      return json(await priceStep(env));
    }
    if (!env.BOT_TOKEN) return json({ ok: false, error: "BOT_TOKEN не задан в настройках Worker" }, 500);

    if (url.pathname === "/webhook" && req.method === "POST") {
      if (req.headers.get("X-Telegram-Bot-Api-Secret-Token") !== (await hookSecret(env))) return new Response("forbidden", { status: 403 });
      const upd = await req.json();
      try {
        if (upd.message) await onMessage(env, upd.message);
        else if (upd.callback_query) await onCallback(env, upd.callback_query);
      } catch (e) {
        console.log("update error", e.stack || e);
      }
      return new Response("ok"); // всегда 200, чтобы Telegram не повторял запрос
    }
    if (url.pathname === "/setup") return json(await setup(env, url.origin));
    if (url.pathname === "/status") {
      const info = await tg(env, "getWebhookInfo", {});
      let subs = 0;
      if (env.USERS) { let c; do { const p = await env.USERS.list({ prefix: "r:", cursor: c }); subs += p.keys.length; c = p.list_complete ? null : p.cursor; } while (c); }
      return json({ webhook: info.result?.url, pending: info.result?.pending_update_count, last_error: info.result?.last_error_message || null, subscribers: subs });
    }
    return new Response("Еда на неделю — сервер бота работает. Бот: https://t.me/racion_food_kz_bot", { headers: { "content-type": "text/plain; charset=utf-8" } });
  },
  async scheduled(event, env, ctx) {
    if (event.cron === "*/20 * * * *") ctx.waitUntil(priceStep(env));
    else ctx.waitUntil(weekly(env));
  },
};
