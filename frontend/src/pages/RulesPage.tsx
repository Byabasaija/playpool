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
              8-Ball Pool is a two-player game. Pot all your balls (solids or stripes) and then sink
              the 8-ball to win. First player to legally pocket the 8-ball wins the game.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-[#373536] mb-2">Setup</h2>
            <ul className="list-disc pl-5 space-y-1">
              <li>15 object balls (7 solids, 7 stripes, 1 eight-ball) and a cue ball</li>
              <li>Balls are racked in a triangle at the foot of the table</li>
              <li>The breaking player shoots from behind the head string</li>
              <li>Groups (solids/stripes) are assigned after the first legal pot</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-[#373536] mb-2">The Break</h2>
            <ul className="list-disc pl-5 space-y-1">
              <li>The cue ball must contact the rack and at least 4 balls must reach a cushion</li>
              <li>If you pot a ball on the break, you continue your turn</li>
              <li>If the cue ball is pocketed on the break, your opponent gets ball-in-hand</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-[#373536] mb-2">On Your Turn</h2>
            <ul className="list-disc pl-5 space-y-1">
              <li>You must hit one of your own balls first</li>
              <li>Pot one of your balls to continue your turn</li>
              <li>If you foul, your opponent gets ball-in-hand (cue ball anywhere on table)</li>
              <li>You cannot pot the 8-ball until all your group balls are pocketed</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-[#373536] mb-2">Fouls</h2>
            <div className="space-y-2">
              <div className="bg-white rounded-lg p-3 border border-gray-200">
                <div className="font-semibold text-[#373536]">No Contact</div>
                <p className="text-gray-600 mt-1">Failing to hit any ball with the cue ball.</p>
              </div>
              <div className="bg-white rounded-lg p-3 border border-gray-200">
                <div className="font-semibold text-[#373536]">Wrong Ball First</div>
                <p className="text-gray-600 mt-1">Hitting your opponent's ball or the 8-ball before your own.</p>
              </div>
              <div className="bg-white rounded-lg p-3 border border-gray-200">
                <div className="font-semibold text-[#373536]">Cue Ball Pocketed</div>
                <p className="text-gray-600 mt-1">Potting the cue ball (scratch) gives your opponent ball-in-hand.</p>
              </div>
              <div className="bg-white rounded-lg p-3 border border-gray-200">
                <div className="font-semibold text-[#373536]">No Cushion After Contact</div>
                <p className="text-gray-600 mt-1">After hitting a ball, at least one ball must reach a cushion or be pocketed.</p>
              </div>
            </div>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-[#373536] mb-2">Winning</h2>
            <div className="space-y-3">
              <div className="bg-white rounded-lg p-3 border border-gray-200">
                <div className="font-semibold text-[#373536]">Legal Win</div>
                <p className="text-gray-600 mt-1">
                  Pot all your group balls and then legally pocket the 8-ball. You must call the pocket.
                </p>
              </div>
              <div className="bg-white rounded-lg p-3 border border-gray-200">
                <div className="font-semibold text-[#373536]">Instant Loss</div>
                <p className="text-gray-600 mt-1">
                  Potting the 8-ball before your group is cleared, or scratching on the 8-ball, loses the game immediately.
                </p>
              </div>
            </div>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-[#373536] mb-2">Stakes</h2>
            <ul className="list-disc pl-5 space-y-1">
              <li>Both players stake the same amount before the game</li>
              <li>Stakes are held in escrow during the game</li>
              <li>The winner receives both stakes minus a platform commission</li>
            </ul>
          </section>

        </div>
      </div>
    </div>
  );
}
