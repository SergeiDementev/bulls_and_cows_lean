# Тексты на русском. Английский — в en.ftl, написан отдельно, а не переводом.

## Шапка: название и правила. Её же присылает бот на /start

header-title = 🐂🐄 Быки и коровы
# $length — сколько цифр в загаданном числе
header-rules = Я загадываю число из { $length } разных цифр от 0 до 9 — ноль может стоять и первым. Попробуйте его угадать.
header-bull = 🐂 бык — цифра есть в числе и стоит на своём месте
header-cow = 🐄 корова — цифра есть, но на другом месте

## Заглавный экран

button-new-game = Новая игра
button-continue-game = Продолжить игру

# Подпись — на том языке, НА который переключает кнопка
button-switch-language = 🌐 English
button-stats = Статистика

## Игра

game-intro = Загадано число из { $length } разных цифр. Наберите догадку на клавиатуре ниже.
game-remaining = Осталось возможных вариантов: { $count }
# Над клетками ввода. Подсказка — только до первого хода
your-move = Ваш ход
your-move-hint = Ваш ход — нажмите на клетку, чтобы вписать цифру в неё
button-erase = ⌫
button-check = ✓ Проверить
button-abandon = Завершить игру

abandon-question = Завершить игру? Загаданное число будет раскрыто.
button-abandon-confirm = Да, завершить
button-abandon-cancel = Нет, играть дальше

# [1] — ровно один ход; [one] — 21, 31… («за 21 попытку»)
game-won =
    { $attempts ->
        [1] 🎉 С первой попытки! Загадано было { $secret }.
        [one] 🎉 Вы угадали число { $secret } за { $attempts } попытку!
        [few] 🎉 Вы угадали число { $secret } за { $attempts } попытки!
       *[other] 🎉 Вы угадали число { $secret } за { $attempts } попыток!
    }
game-abandoned = Игра завершена. Было загадано число { $secret }.

## Статистика и рейтинг

button-back = Назад
stats-title = 📊 Ваша статистика
stats-no-games = Сыграйте первую игру — здесь появится ваша статистика.
stat-games-played = Сыграно игр
stat-wins = Побед
stat-best = Лучший результат
# $games — по скольким последним играм посчитано среднее (до 20)
stat-average =
    { $games ->
        [1] Среднее за последнюю игру
        [one] Среднее за { $games } игру
        [few] Среднее за { $games } игры
       *[other] Среднее за { $games } игр
    }
# Среднее в плитке и в рейтинге: одна цифра после запятой
average = { NUMBER($average, maximumFractionDigits: 1) }

leaderboard-title = 🏆 Рейтинг по среднему числу попыток
# Имя игрока без username в Telegram
leaderboard-player = Игрок #{ $number }
leaderboard-empty = Пока в рейтинге никого нет — станьте первым.
# $place — порядковое число; по-русски форма одна: «на 14-м месте»
leaderboard-me-place = Вы на { $place }-м месте со средним { NUMBER($average, maximumFractionDigits: 1) }.
leaderboard-me-need-wins =
    До рейтинга — ещё { $left } { $left ->
        [one] победа
        [few] победы
       *[other] побед
    }.
leaderboard-rule = Учитываются игроки, у которых не меньше { $minWins } побед среди последних { $window } игр.

## Короткие уведомления

toast-need-more-digits =
    Нужно { $length } { $length ->
        [one] цифра
        [few] цифры
       *[other] цифр
    }
toast-input-full =
    Уже набрано { $length } { $length ->
        [one] цифра
        [few] цифры
       *[other] цифр
    }. Нажмите на клетку, чтобы заменить

## Сбои

offline = Нет связи с сервером
button-retry = Повторить
open-in-telegram = Откройте игру в Telegram
button-open-bot = Открыть бота
session-expired = Игра открыта слишком давно. Закройте её и откройте снова
button-close = Закрыть
error-unexpected = Что-то пошло не так. Попробуйте ещё раз.
error-service-unavailable = Игра сейчас недоступна. Попробуйте через минуту.

## Подписи для экранного диктора: на экране вместо них значки и цифры

label-cell = Клетка { $position }
label-erase = Стереть
label-used-digit = Цифра { $digit } уже набрана
label-bulls = Быки
label-cows = Коровы

## Бот

bot-button-play = Играть
# Описание бота в пустом чате. Одно на двух языках и одинаковое в обоих файлах: Telegram
# выбирает описание по языку своего приложения, а не по языку игры (решение автора)
bot-description = 🐂🐄 Быки и коровы · Bulls & Cows
