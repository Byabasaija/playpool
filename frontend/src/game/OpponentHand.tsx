import React from 'react';
import { Card } from './Card';

interface OpponentHandProps {
  cardCount: number;
}

export const OpponentHand: React.FC<OpponentHandProps> = ({ cardCount }) => {
  const stackWidth = Math.max(160, cardCount * 22);

  return (
    <div className="flex justify-center items-start py-4">
      <div className="relative" style={{ width: stackWidth }}>
        {Array.from({ length: cardCount }).map((_, index) => {
          const offset = index * 14; // px
          const rotation = (index - cardCount / 2) * 1.5; // gentle fan

          return (
            <div
              key={index}
              className="absolute top-0"
              style={{
                left: `${offset}px`,
                transform: `rotate(${rotation}deg)` ,
                zIndex: index
              }}
            >
              <Card faceDown />
            </div>
          );
        })}
      </div>
    </div>
  );
};
