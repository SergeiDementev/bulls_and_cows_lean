# Деплой на ВМ

Для сессии Claude Code на ВМ Oracle Cloud и для автора, который подтверждает каждое изменяющее действие. Устройство — [decisions.md](decisions.md), «Устройство».

## Правила для агента на сервере

- **Изменяющее действие — только после подтверждения автора.** Посмотреть, вывести состояние — без подтверждения.
- **rpg_tele_bot не трогать:** его папку, контейнеры, тома, cron и бакет — только смотреть. Никаких `docker system prune`, `docker volume prune` и остановок «всех контейнеров».
- **Секреты не выводить:** `.env`, токен бота, пароли. Проверять — наличием и длиной значения.
- После каждого запуска — состояние, логи, проверка здоровья: «контейнер запущен» ≠ «приложение работает».
- Шаг не удался — остановиться, показать вывод, предложить причину. Не обходить.

`$C` ниже — `docker compose -f docker/compose.prod.yml --env-file .env`, из папки `/home/ubuntu/bulls_and_cows_lean`.

## Переключение с первой версии (один раз, этап 3)

Первая версия: папка `/home/ubuntu/bulls_and_cows`, Compose-проект `bulls-and-cows`. Её данные не переносятся.

### 1. Осмотреться — только чтение

```sh
docker ps --format '{{.Names}}\t{{.Status}}\t{{.Ports}}'
crontab -l
df -h / && free -h
getent hosts bulls-and-cows-telebot.duckdns.org && curl -s ifconfig.me; echo
```

- **Обновление адреса DuckDNS:** есть ли оно и где — в cron, в отдельном контейнере, в проекте первой версии? Если внутри проекта первой версии — **остановиться и показать автору**: при удалении первой версии адрес перестанет обновляться. Если IP сервера постоянный и обновления нет — так и записать.
- Что из cron относится к первой версии (копии `docker/backup/backup.sh`) — показать.

### 2. Код

Автор добавляет ключ развёртывания (Deploy key, только чтение) в GitHub → репозиторий `bulls_and_cows_lean` → Settings → Deploy keys. Затем:

```sh
git clone git@github.com:SergeiDementev/bulls_and_cows_lean.git /home/ubuntu/bulls_and_cows_lean
cd /home/ubuntu/bulls_and_cows_lean && git checkout stage-3-webapp
```

### 3. Настройки

```sh
cp docker/prod.env.example .env && chmod 600 .env
```

- `POSTGRES_PASSWORD`, `APP_DB_PASSWORD`, `WEBHOOK_SECRET` — `openssl rand -hex 24`, вписать не показывая.
- `BOT_TOKEN` и `BOT_USERNAME` — перенести из `/home/ubuntu/bulls_and_cows/.env`, не показывая значений.
- Проверка: каждая переменная из `prod.env.example` задана — имена и длины значений.

### 4. Собрать образы — первая версия ещё работает

```sh
$C build
```

### 5. ⚠️ Удалить первую версию — необратимо

**С этого шага бот первой версии перестаёт отвечать, её данные удаляются.**

```sh
cd /home/ubuntu/bulls_and_cows
docker compose -f docker/docker-compose.prod.yml --env-file .env down -v --rmi local
```

Убрать из `crontab` строку копий первой версии; остальные строки не трогать. Папку `/home/ubuntu/bulls_and_cows` оставить до этапа 5.

### 6. Запустить новую версию

```sh
cd /home/ubuntu/bulls_and_cows_lean
$C up -d --wait
$C ps
$C logs app --tail 30      # «migrations applied», «Server listening»
$C logs caddy --tail 30    # «certificate obtained successfully» для адреса
```

Проверки снаружи:

```sh
curl -s -o /dev/null -w '%{http_code}\n' https://bulls-and-cows-telebot.duckdns.org/      # 200
curl -s -X POST https://bulls-and-cows-telebot.duckdns.org/api/session                     # auth.unauthorized
```

### 7. Настроить бота

```sh
$C exec app node scripts/bot-setup.ts
```

Каждая строка — `"ok":true`: webhook, описание на en и ru, пустой список команд. Кнопка меню и главное приложение бота уже указывают на этот адрес — в @BotFather ничего менять не нужно.

### 8. Ручная проверка автора

- Пустой чат с ботом → описание; «Начать» → правила и кнопка «Играть».
- Mini App кнопкой меню: партия до победы, завершение, «Продолжить игру» после закрытия и открытия.
- VoiceOver на iPhone SE; светлая и тёмная тема; «уменьшить движение» — без анимации победы.

## Адрес DuckDNS

IP ВМ меняется при перезапуске, автоматического обновления адреса пока нет (появится на этапе 5). После перезапуска ВМ: узнать новый IP (`curl -s ifconfig.me`) и обновить адрес в кабинете DuckDNS вручную.

## Обновление

```sh
cd /home/ubuntu/bulls_and_cows_lean
git fetch && git checkout <ветка или main> && git pull
$C up -d --build --wait
$C ps && $C logs app --tail 30
```

## Откат

На прошлый выпуск: `git checkout <тег>` и `$C up -d --build --wait`. Миграции пишутся только вперёд и не ломают предыдущую версию кода до следующего выпуска.
