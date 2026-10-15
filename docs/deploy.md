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

## Эксплуатация: копии, адрес, уборка (один раз, этап 5)

Сначала — обновление на ветку этапа (раздел «Обновление» ниже).

### 1. Осмотреться — только чтение

```sh
ls -l /home/ubuntu/.oci-cli-venv/bin/oci                              # oci — тот же, что у rpg_tele_bot
/home/ubuntu/.oci-cli-venv/bin/oci os ns get --auth instance_principal   # неймспейс хранилища
/home/ubuntu/.oci-cli-venv/bin/oci os object list --auth instance_principal \
  --bucket-name bulls-and-cows-backups --namespace <неймспейс> --all --query 'data[].name'
crontab -l
```

В бакете могут лежать копии первой версии (`bulls_and_cows_…`) — показать список.

### 2. Настройки

В `.env` добавить (образец — `docker/prod.env.example`):

- `OCI_NAMESPACE` — из шага 1, не секрет;
- `DUCKDNS_TOKEN` — вписывает **автор** (кабинет DuckDNS), не показывая.

### 3. Первая копия — вручную

```sh
docker/backup/backup.sh
tail -5 logs/backup.log          # «backup complete: bulls_lean_…»
docker/backup/restore.sh         # без имени — список копий: новая в нём есть
```

### 4. Адрес DuckDNS

```sh
docker/duckdns.sh && cat logs/duckdns.log   # «address now points to …» или пусто, если IP уже верный
```

### 5. Расписание

`crontab -e` пользователя `ubuntu` — **добавить** три строки, остальные (rpg_tele_bot) не трогать:

```
30 0 * * * /home/ubuntu/bulls_and_cows_lean/docker/backup/backup.sh
*/5 * * * * /home/ubuntu/bulls_and_cows_lean/docker/duckdns.sh
@reboot sleep 30 && /home/ubuntu/bulls_and_cows_lean/docker/duckdns.sh
```

### 6. Уборка — необратимо, каждое — с подтверждения

- Копии первой версии в бакете (`bulls_and_cows_…`) — удалить.
- `~/bulls_lean_before_0002.sql.gz` — удалить (есть свежая копия из шага 3).
- Папка первой версии `/home/ubuntu/bulls_and_cows` — удалить.

### 7. Описание бота

```sh
$C exec app node scripts/bot-setup.ts    # каждая строка — "ok":true
```

### 8. Ручная проверка автора — восстановление

1. Сыграть партию, запомнить «Статистику».
2. `docker/backup/backup.sh` — свежая копия.
3. Сыграть ещё одну партию — после восстановления её не будет.
4. `docker/backup/restore.sh <копия из шага 2>` — подтвердить.
5. «Статистика» — как в шаге 1; игра работает.

На следующий день: в `logs/backup.log` — ночная копия.

## Копии и восстановление

- **`docker/backup/backup.sh`** — копия всей базы (`pg_dump`, сжатие), проверка, что дамп полный, загрузка в Object Storage (бакет `bulls-and-cows-backups`, имена `bulls_lean_<время>.sql.gz`), сверка размера, удаление копий старше 7 дней. Вход в Oracle — правами самой ВМ, ключей на диске нет. Журнал — `logs/backup.log`; при сбое — строка `ERROR` с названием шага.
- **`docker/backup/restore.sh`** — без аргументов список копий; `restore.sh <копия>` — скачать, проверить, спросить подтверждение (`--yes` — без вопроса), сохранить текущую базу в `logs/before-restore-…sql.gz`, остановить сервер, залить копию одной транзакцией, запустить сервер. Сбой при заливке — база остаётся прежней, сервер запускается снова. Журнал — `logs/restore.log`.

## Адрес DuckDNS

IP ВМ меняется при перезапуске. `docker/duckdns.sh` раз в 5 минут и при старте ВМ сообщает DuckDNS текущий IP; в `logs/duckdns.log` — только изменения и ошибки. Если адрес всё же не тот: `curl -s ifconfig.me` и вписать IP в кабинете DuckDNS вручную.

## Обновление

Перед обновлением, которое меняет схему базы (новая миграция в `src/server/migrations/`), — копия: `docker/backup/backup.sh`.

```sh
cd /home/ubuntu/bulls_and_cows_lean
git fetch --prune && git checkout <ветка или main> && git pull
$C up -d --build --wait
$C ps && $C logs app --tail 30      # «migrations applied», «Server listening»
```

После слияния PR сервер возвращается на `main`: та же команда с `main`; если код тот же — пересборка не нужна.

## Откат

На прошлый выпуск: `git checkout <тег>` и `$C up -d --build --wait`. Миграции пишутся только вперёд и не ломают предыдущую версию кода до следующего выпуска.
