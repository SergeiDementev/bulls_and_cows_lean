# English texts. Written on their own, not translated from ru.ftl: puzzle-game wording.

## Header: name and rules. The bot sends it on /start too

header-title = 🐂🐄 Bulls & Cows
header-rules = I'm thinking of a { $length }-digit number. All its digits are different, and 0 can come first. Can you crack it?
header-bull = 🐂 Bull — right digit, right spot
header-cow = 🐄 Cow — right digit, wrong spot

## Title screen

button-new-game = New game
button-continue-game = Resume game

# The label is in the language the button switches TO
button-switch-language = 🌐 Русский
button-stats = Stats

## Game

game-intro = Crack the { $length }-digit number. Tap your guess on the keypad below.
game-remaining =
    { $count ->
        [one] Only one number fits now — you've got it.
       *[other] Numbers that still fit: { $count }
    }
your-move = Your guess
your-move-hint = Your guess — tap a box to put a digit there
button-erase = ⌫
button-check = ✓ Guess
button-abandon = Give up

abandon-question = Give up? I'll reveal the number.
button-abandon-confirm = Yes, give up
button-abandon-cancel = Keep playing

game-won =
    { $attempts ->
        [1] 🎉 First try! The number was { $secret }.
       *[other] 🎉 Cracked it! The number was { $secret } — you got it in { $attempts } guesses.
    }
game-abandoned = Game over. The number was { $secret }.

## Stats and leaderboard

button-back = Back
stats-title = 📊 Your stats
stats-no-games = Play your first game and your stats will show up here.
stat-games-played = Games played
stat-wins = Wins
stat-best = Fewest guesses
stat-average =
    { $games ->
        [one] Average, last game
       *[other] Average, last { $games } games
    }
average = { NUMBER($average, maximumFractionDigits: 1) }

leaderboard-title = 🏆 Leaderboard — fewest guesses on average
leaderboard-player = Player #{ $number }
leaderboard-empty = Nobody on the board yet — be the first.
# $place is an ordinal: 1st, 2nd, 3rd, 14th
leaderboard-me-place =
    You're { $place }{ $place ->
        [one] st
        [two] nd
        [few] rd
       *[other] th
    } with an average of { NUMBER($average, maximumFractionDigits: 1) }.
leaderboard-me-need-wins =
    { $left ->
        [one] One more win to make the board.
       *[other] { $left } more wins to make the board.
    }
leaderboard-rule = To be ranked, you need { $minWins } wins in your last { $window } games.

## Toasts

toast-need-more-digits = Enter all { $length } digits first.
toast-input-full = All { $length } boxes are full. Tap one to change it

## Failures

offline = Can't reach the server
button-retry = Try again
open-in-telegram = This game runs inside Telegram
button-open-bot = Open the bot
session-expired = This game has been open too long. Close it and open it again
button-close = Close
error-unexpected = Oops, something went wrong. Please try again.
error-service-unavailable = The game is down right now. Try again in a minute.

## Screen reader labels: the screen shows icons and digits instead

label-cell = Box { $position }
label-erase = Delete
label-used-digit = { $digit } is already in your guess
label-bulls = Bulls
label-cows = Cows

## Bot

bot-button-play = Play
# Bot description: shown in an empty chat before the Start button
bot-description = Bulls & Cows, a logic puzzle. I think of a { $length }-digit number with no repeated digits; you crack it from the clues: 🐂 Bull — right digit, right spot; 🐄 Cow — right digit, wrong spot.
