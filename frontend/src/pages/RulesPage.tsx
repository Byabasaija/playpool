import { Link } from 'react-router-dom';

export function RulesPage() {
  return (
    <div className="min-h-screen bg-[#F5F0EB]">
      <div className="max-w-2xl mx-auto px-4 py-8">
        <Link to="/" className="text-sm text-gray-500 hover:text-gray-700 mb-4 inline-block">&larr; Back</Link>

        <h1 className="text-2xl font-bold text-[#373536] mb-6">How to Play Pool</h1>

        <div className="space-y-6 text-sm text-gray-800">

          <section>
            <h2 className="text-lg font-semibold text-[#373536] mb-2">Overview</h2>
            <p>
              Pool is a fast-paced two-player pool game. Pot your balls strategically
              and sink the 8-ball to win.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-[#373536] mb-2">Setup</h2>
            <ul className="list-disc pl-5 space-y-1">
              <li>Standard 52-card deck (no Jokers)</li>
              <li>Each player is dealt <strong>7 cards</strong></li>
              <li>A random player goes first</li>
              <li>The first player can play any card to start</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-[#373536] mb-2">On Your Turn</h2>
            <p className="mb-2">You must either play a valid card or draw from the deck:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Play a card that matches the <strong>suit</strong> of the current card</li>
              <li>Play a card that matches the <strong>rank</strong> of the top card</li>
              <li>Play an <strong>Ace</strong> (wild &mdash; can be played on anything)</li>
              <li>If you can't play, <strong>draw one card</strong>. You may then play it if it's valid, or pass</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-[#373536] mb-2">Special Cards</h2>
            <div className="space-y-3">
              <div className="bg-white rounded-lg p-3 border border-gray-200">
                <div className="font-semibold text-[#373536]">2 &mdash; Draw Two</div>
                <p className="text-gray-600 mt-1">
                  Playing a 2 forces your opponent to draw 2 penalty cards and lose their turn.
                  They can counter by playing their own 2, which bounces the penalty back to you.
                </p>
              </div>
              <div className="bg-white rounded-lg p-3 border border-gray-200">
                <div className="font-semibold text-[#373536]">Ace &mdash; Wild Suit</div>
                <p className="text-gray-600 mt-1">
                  An Ace can be played on any card. When you play it, you choose the suit
                  the next player must follow. If it's your last card, you win immediately.
                </p>
              </div>
              <div className="bg-white rounded-lg p-3 border border-gray-200">
                <div className="font-semibold text-[#373536]">Jack &amp; 8 &mdash; Skip</div>
                <p className="text-gray-600 mt-1">
                  Playing a Jack or an 8 skips your opponent's turn. You get to play again immediately.
                </p>
              </div>
            </div>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-[#373536] mb-2">Winning</h2>
            <p className="mb-2">There are two ways to win a round:</p>
            <div className="space-y-3">
              <div className="bg-white rounded-lg p-3 border border-gray-200">
                <div className="font-semibold text-[#373536]">Classic Win</div>
                <p className="text-gray-600 mt-1">
                  Be the first player to play all your cards. The moment you play your last card, you win.
                </p>
              </div>
              <div className="bg-white rounded-lg p-3 border border-gray-200">
                <div className="font-semibold text-[#373536]">Chop Win</div>
                <p className="text-gray-600 mt-1">
                  At the start of each game, a target suit is chosen. If you play the <strong>7 of that suit</strong>,
                  the game ends immediately and both players' remaining cards are scored.
                  The player with the <strong>lower</strong> total points wins. A tie means a draw and stakes are refunded.
                </p>
              </div>
            </div>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-[#373536] mb-2">Card Point Values</h2>
            <p className="mb-2 text-gray-600">Points only matter for Chop wins:</p>
            <div className="bg-white rounded-lg p-3 border border-gray-200">
              <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
                <div className="flex justify-between"><span>2</span><span className="font-semibold">20 pts</span></div>
                <div className="flex justify-between"><span>Ace</span><span className="font-semibold">15 pts</span></div>
                <div className="flex justify-between"><span>King</span><span className="font-semibold">13 pts</span></div>
                <div className="flex justify-between"><span>Queen</span><span className="font-semibold">12 pts</span></div>
                <div className="flex justify-between"><span>Jack</span><span className="font-semibold">11 pts</span></div>
                <div className="flex justify-between"><span>10</span><span className="font-semibold">10 pts</span></div>
                <div className="flex justify-between"><span>9</span><span className="font-semibold">9 pts</span></div>
                <div className="flex justify-between"><span>8</span><span className="font-semibold">8 pts</span></div>
                <div className="flex justify-between"><span>7</span><span className="font-semibold">7 pts</span></div>
                <div className="flex justify-between"><span>6</span><span className="font-semibold">6 pts</span></div>
                <div className="flex justify-between"><span>5</span><span className="font-semibold">5 pts</span></div>
                <div className="flex justify-between"><span>4</span><span className="font-semibold">4 pts</span></div>
                <div className="flex justify-between"><span>3</span><span className="font-semibold">3 pts</span></div>
              </div>
            </div>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-[#373536] mb-2">Drawing &amp; Deck</h2>
            <ul className="list-disc pl-5 space-y-1">
              <li>If you can't play, you draw one card from the deck</li>
              <li>After drawing, you may play the drawn card if valid, or pass</li>
              <li>If the deck runs out, the discard pile (except the top card) is reshuffled into a new deck</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-[#373536] mb-2">Stakes</h2>
            <ul className="list-disc pl-5 space-y-1">
              <li>Both players stake the same amount before the game</li>
              <li>Stakes are held in escrow during the game</li>
              <li>The winner receives both stakes minus a platform commission</li>
              <li>Draws result in full refunds to both players</li>
            </ul>
          </section>

        </div>
      </div>
    </div>
  );
}
