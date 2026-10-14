# English texts. Written on their own, not translated from ru.ftl: puzzle-game wording.

## Header: name and rules. The bot sends it on /start too

header-title = 🐂🐄 Bulls & Cows
header-rules = I'm thinking of a { $length }-digit number. All its digits are different, and 0 can come first. Can you crack it?
header-bull = 🐂 Bull — right digit, right spot
header-cow = 🐄 Cow — right digit, wrong spot

## Title screen

button-new-game = New game
button-continue-game = Resume game

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
