import React from 'react';
import { AnimatePresence } from 'framer-motion';
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
        <AnimatePresence mode="popLayout">
          {Array.from({ length: cardCount }).map((_, index) => {
            const offset = index * cardOffset;
            const rotation = (index - cardCount / 2) * 1.5; // gentle fan

            return (
              <div
                key={`opp-card-${index}`}
                className="absolute top-0"
                style={{
                  left: `${offset}px`,
                  transform: `rotate(${rotation}deg)` ,
                  zIndex: index
                }}
              >
                <Card 
                  faceDown
                  initial={{ opacity: 0, y: -100, scale: 0.8 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.5, transition: { duration: 0.2 } }}
                />
              </div>
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
};
