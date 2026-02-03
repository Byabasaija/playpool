import React from 'react';
import { Card } from './Card';

interface OpponentHandProps {
  cardCount: number;
}

export const OpponentHand: React.FC<OpponentHandProps> = ({ cardCount }) => {
  // Responsive stack width and offsets
  const getStackDimensions = () => {
    const isMobile = window.innerWidth < 640;
    const isTablet = window.innerWidth < 768;
    
    const cardOffset = isMobile ? 10 : isTablet ? 12 : 14;
    const minWidth = isMobile ? 120 : isTablet ? 140 : 160;
    const stackWidth = Math.max(minWidth, cardCount * (cardOffset + 6));
    
    return { stackWidth, cardOffset };
  };

  const { stackWidth, cardOffset } = getStackDimensions();

  return (
    <div className="flex justify-center items-start py-2 sm:py-4">
      <div className="relative" style={{ width: stackWidth }}>
        {Array.from({ length: cardCount }).map((_, index) => {
          const offset = index * cardOffset;
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
