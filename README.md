# Еда на неделю (Алматы) — Telegram Mini App

Бот: https://t.me/racion_food_kz_bot · Приложение: https://clvdky.github.io/racion-food/

Квиз → меню на 7 дней с КБЖУ → список покупок с ценами Magnum / Small / Arbuz.
Работает внутри Telegram как мини-приложение. Вкладки: Рацион, Покупки, Цены, Рецепты, Профиль.
Цены парсятся раз в день на твоём компьютере (Mac или Windows) и публикуются на GitHub Pages. Сервер не нужен.

## Как поменять название и бота
- **Название в приложении**: `config.json → app_name`, затем `python build_app.py` и push.
- **Имя бота в Telegram**: @BotFather → `/setname` → выбрать бота → новое имя. Меняется сразу, без кода.
- **Описание / «о боте» / аватар**: @BotFather → `/setdescription`, `/setabouttext`, `/setuserpic`.
- **Username (@racion_food_kz_bot)**: в BotFather его сменить нельзя. Варианты: создать нового бота (`/newbot`), настроить ему Mini App на ту же ссылку и вписать новую ссылку в `config.json → bot_link`; либо купить коллекционный username на Fragment.
- **Ссылка на приложение**: @BotFather → `/mybots` → бот → Bot Settings → Configure Mini App / Menu Button.

## Подключение к Telegram (уже сделано)
1. В @BotFather: `/newbot` → имя и username бота → получишь токен (для мини-аппа он не нужен, сохрани на будущее).
2. Включи GitHub Pages (ниже), получишь ссылку `https://<логин>.github.io/racion/`.
3. В @BotFather: `/mybots` → бот → Bot Settings → Configure Mini App → Enable → вставь ссылку Pages.
   Там же Menu Button → та же ссылка, текст кнопки «Открыть рацион».
4. Впиши ссылку на бота в `config.json → bot_link` (`https://t.me/<username>`) и пересобери: `python build_app.py`.
5. Описание бота: Bot Settings → Edit Description — «Бесплатный рацион на неделю с ценами Magnum, Small и Arbuz».

Что даёт Telegram:
- тема (светлая/тёмная) и цвета берутся из Telegram;
- ответы, меню и отметки покупок хранятся в Telegram CloudStorage — видны на телефоне и компьютере;
- «Отправить в чат» — список покупок уходит в любой чат (например, жене или в семейный);
- кнопка «Назад» Telegram работает в опросе и в карточке рецепта.

## Windows
```powershell
cd $HOME\racion
py -m venv .venv
.\.venv\Scripts\pip install -r requirements.txt
.\update.ps1 -NoPush          # проверка
```
Автозапуск каждый день в 08:10 (PowerShell от своего пользователя):
```powershell
schtasks /Create /SC DAILY /ST 08:10 /TN "RacionPrices" /TR "powershell -ExecutionPolicy Bypass -File $HOME\racion\update.ps1"
```
Если скрипты заблокированы: `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.

## Структура
- `data/products.json` — справочник продуктов: КБЖУ, поисковый запрос, правила сопоставления
- `data/recipes.json` — рецепты (граммы на 1 порцию). Добавляй свои по тому же формату
- `data/fallback_prices.json` — ориентировочные цены, если товар не нашёлся
- `scrapers/` — парсеры: `arbuz.py` (HTML), `kaspi_magnum.py` (Kaspi API), `wolt_small.py` (Wolt API)
- `docs/` — приложение (`index.html`) и `prices.json`, отсюда раздаёт GitHub Pages
- `config.json` — город, фильтр Magnum в Kaspi, магазин Small в Wolt

## Установка на Mac (один раз)
```bash
cd ~ && git clone <твой-репозиторий> racion && cd racion   # или распакуй архив в ~/racion и сделай git init
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```
1. Создай репозиторий на GitHub, запушь проект.
2. GitHub → Settings → Pages → Source: `main`, папка `/docs`. Ссылка вида `https://<логин>.github.io/racion/`.

## Настройка источников
**Magnum (Kaspi).** Открой kaspi.kz/shop в Chrome → раздел Magnum → DevTools (⌥⌘I) → Network → фильтр `results`.
Найди запрос `product-view/pl/results`, скопируй значение параметра `q` (например `:availableInZones:Magnum_ZONE1`)
и вставь в `config.json → kaspi_filter`.

**Small (Wolt).** На wolt.com открой ближайший Small. Из адреса `.../venue/<slug>` возьми slug → `config.json → wolt_small_slug`.

## Первый запуск
```bash
./update.sh --no-push
```
В логе по каждому продукту: ✓ найдено (цена за кг/л/шт и какой товар выбран) или · не найдено.
Если по магазину ничего не нашлось — смотри файлы в `debug/` (там сырой ответ сайта) и пришли их мне.
Если выбирается не тот товар — поправь `must` / `excl` у продукта в `data/products.json`.

## Автообновление на Mac (launchd)
```bash
sed -i '' "s|/Users/USERNAME|$HOME|" launchd/kz.racion.prices.plist
cp launchd/kz.racion.prices.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/kz.racion.prices.plist
launchctl start kz.racion.prices   # проверить сразу
```
Запуск в 08:10. Если Mac спал, задача выполнится после пробуждения. Логи — в `logs/`.
Для `git push` без пароля нужен SSH-ключ или `gh auth login`.

## Как считается
- Калории: формула Миффлина — Сан-Жеора × активность; похудение −18%, набор +12%.
- Порции масштабируются (×0,6–1,8) под калории приёма пищи. Блюдо повторяется не чаще 2 раз в неделю.
- Если сумма выше бюджета, генератор сдвигает выбор к более дешёвым блюдам (по цене за 1000 ккал).
- Цена позиции = минимальная цена за кг/л/шт среди магазинов × нужный вес. Упаковки не округляются.
- Цены на Wolt могут быть немного выше полочных в Small.
