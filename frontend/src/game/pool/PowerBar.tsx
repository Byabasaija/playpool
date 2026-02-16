// Vertical power bar shown during shot charging.

import { MAX_POWER } from './constants';

interface PowerBarProps {
  power: number;
  visible: boolean;
}

export default function PowerBar({ power, visible }: PowerBarProps) {
  if (!visible) return null;

  const pct = Math.min(power / MAX_POWER, 1);
  const r = 255;
  const g = Math.round(255 * (1 - pct));
  const color = `rgb(${r},${g},0)`;

  return (
    <div className="flex flex-col items-center gap-0.5" style={{ height: 200 }}>
      <div className="relative w-5 flex-1 rounded-full overflow-hidden bg-gray-700 border border-gray-500">
        <div
          className="absolute bottom-0 left-0 right-0 rounded-full transition-all duration-75"
          style={{ height: `${pct * 100}%`, backgroundColor: color }}
        />
      </div>
      <span className="text-[10px] text-gray-400">{Math.round(pct * 100)}%</span>
    </div>
  );
}
