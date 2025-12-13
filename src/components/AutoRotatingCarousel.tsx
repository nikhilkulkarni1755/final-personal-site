import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface AutoRotatingCarouselProps {
  items: any[];
  renderItem: (item: any) => React.ReactNode;
  interval?: number;
  title: string;
}

const AutoRotatingCarousel = ({
  items,
  renderItem,
  interval = 5000,
  title
}: AutoRotatingCarouselProps) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [direction, setDirection] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const timerRef = useRef<number | null>(null);

  const startTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
    }
    timerRef.current = setInterval(() => {
      handleNext();
    }, interval);
  };

  useEffect(() => {
    if (!isPaused && items.length > 1) {
      startTimer();
    }
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [currentIndex, isPaused, items.length, interval]);

  const handleNext = () => {
    setDirection(1);
    setCurrentIndex((prev) => (prev + 1) % items.length);
  };

  const handlePrev = () => {
    setDirection(-1);
    setCurrentIndex((prev) => (prev - 1 + items.length) % items.length);
  };

  const slideVariants = {
    enter: (direction: number) => ({
      x: direction > 0 ? '100%' : '-100%',
      opacity: 0,
    }),
    center: {
      x: 0,
      opacity: 1,
    },
    exit: (direction: number) => ({
      x: direction > 0 ? '-100%' : '100%',
      opacity: 0,
    }),
  };

  if (items.length === 0) return null;

  return (
    <div className="w-full">
      <h2 className="text-2xl sm:text-3xl font-bold text-[#001F3F] dark:text-white mb-6">
        {title}
      </h2>
      <div
        className="relative overflow-hidden bg-white dark:bg-[#001F3F] border border-[#001F3F]/10 dark:border-white/10 rounded-lg shadow-lg"
        onMouseEnter={() => setIsPaused(true)}
        onMouseLeave={() => setIsPaused(false)}
      >
        <div className="relative min-h-[300px] flex items-center justify-center p-8">
          <AnimatePresence initial={false} custom={direction} mode="wait">
            <motion.div
              key={currentIndex}
              custom={direction}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{
                x: { type: 'spring', stiffness: 300, damping: 30 },
                opacity: { duration: 0.2 },
              }}
              className="w-full"
            >
              {renderItem(items[currentIndex])}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Navigation Buttons */}
        {items.length > 1 && (
          <>
            <button
              onClick={handlePrev}
              className="absolute left-4 top-1/2 -translate-y-1/2 p-2 bg-[#001F3F]/80 dark:bg-white/80 text-white dark:text-[#001F3F] rounded-full hover:bg-[#001F3F] dark:hover:bg-white transition-all duration-300 z-10"
              aria-label="Previous"
            >
              <ChevronLeft className="w-6 h-6" />
            </button>
            <button
              onClick={handleNext}
              className="absolute right-4 top-1/2 -translate-y-1/2 p-2 bg-[#001F3F]/80 dark:bg-white/80 text-white dark:text-[#001F3F] rounded-full hover:bg-[#001F3F] dark:hover:bg-white transition-all duration-300 z-10"
              aria-label="Next"
            >
              <ChevronRight className="w-6 h-6" />
            </button>
          </>
        )}

        {/* Indicators */}
        {items.length > 1 && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2 z-10">
            {items.map((_, index) => (
              <button
                key={index}
                onClick={() => {
                  setDirection(index > currentIndex ? 1 : -1);
                  setCurrentIndex(index);
                }}
                className={`h-2 rounded-full transition-all duration-300 ${
                  index === currentIndex
                    ? 'w-8 bg-[#001F3F] dark:bg-white'
                    : 'w-2 bg-[#001F3F]/30 dark:bg-white/30'
                }`}
                aria-label={`Go to slide ${index + 1}`}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default AutoRotatingCarousel;
