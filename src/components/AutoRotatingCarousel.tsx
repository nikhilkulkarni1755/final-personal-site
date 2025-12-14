import { useEffect, useRef, useState } from 'react';
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
  title
}: AutoRotatingCarouselProps) => {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [isPaused, setIsPaused] = useState(false);
  const animationRef = useRef<number | null>(null);
  const scrollSpeedRef = useRef(0.5); // pixels per frame

  // Auto-scroll animation
  useEffect(() => {
    if (!scrollContainerRef.current || items.length <= 1) return;

    const scroll = () => {
      if (!scrollContainerRef.current || isPaused) {
        animationRef.current = requestAnimationFrame(scroll);
        return;
      }

      const container = scrollContainerRef.current;
      const maxScroll = container.scrollWidth - container.clientWidth;

      // Scroll to the right
      container.scrollLeft += scrollSpeedRef.current;

      // Reset to beginning when we reach the end for infinite scroll
      if (container.scrollLeft >= maxScroll) {
        container.scrollLeft = 0;
      }

      animationRef.current = requestAnimationFrame(scroll);
    };

    animationRef.current = requestAnimationFrame(scroll);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [isPaused, items.length]);

  const handleScroll = (direction: 'left' | 'right') => {
    if (!scrollContainerRef.current) return;

    const scrollAmount = 400;
    const newScrollPosition = scrollContainerRef.current.scrollLeft +
      (direction === 'right' ? scrollAmount : -scrollAmount);

    scrollContainerRef.current.scrollTo({
      left: newScrollPosition,
      behavior: 'smooth'
    });
  };

  if (items.length === 0) return null;

  return (
    <div className="w-full">
      <h2 className="text-2xl sm:text-3xl font-bold text-[#001F3F] dark:text-white mb-6">
        {title}
      </h2>
      <div
        className="relative bg-white dark:bg-[#001F3F] border border-[#001F3F]/10 dark:border-white/10 rounded-lg shadow-lg"
        onMouseEnter={() => setIsPaused(true)}
        onMouseLeave={() => setIsPaused(false)}
      >
        <div
          ref={scrollContainerRef}
          className="overflow-x-auto overflow-y-hidden scrollbar-hide scroll-smooth"
          style={{
            scrollbarWidth: 'none',
            msOverflowStyle: 'none'
          }}
        >
          <div className="flex gap-4 p-6">
            {/* Render all items, duplicated for infinite scroll effect */}
            {[...items, ...items].map((item, index) => (
              <div
                key={index}
                className="flex-shrink-0 w-[280px] sm:w-[320px] md:w-[350px]"
              >
                {renderItem(item)}
              </div>
            ))}
          </div>
        </div>

        {/* Navigation Buttons */}
        {items.length > 1 && (
          <>
            <button
              onClick={() => handleScroll('left')}
              className="absolute left-4 top-1/2 -translate-y-1/2 p-2 bg-[#001F3F]/80 dark:bg-white/80 text-white dark:text-[#001F3F] rounded-full hover:bg-[#001F3F] dark:hover:bg-white transition-all duration-300 z-10"
              aria-label="Scroll left"
            >
              <ChevronLeft className="w-6 h-6" />
            </button>
            <button
              onClick={() => handleScroll('right')}
              className="absolute right-4 top-1/2 -translate-y-1/2 p-2 bg-[#001F3F]/80 dark:bg-white/80 text-white dark:text-[#001F3F] rounded-full hover:bg-[#001F3F] dark:hover:bg-white transition-all duration-300 z-10"
              aria-label="Scroll right"
            >
              <ChevronRight className="w-6 h-6" />
            </button>
          </>
        )}

        {/* Gradient overlays for edge fade effect */}
        <div className="absolute left-0 top-0 bottom-0 w-16 bg-gradient-to-r from-white dark:from-[#001F3F] to-transparent pointer-events-none" />
        <div className="absolute right-0 top-0 bottom-0 w-16 bg-gradient-to-l from-white dark:from-[#001F3F] to-transparent pointer-events-none" />
      </div>

      {/* Hide scrollbar with CSS */}
      <style>{`
        .scrollbar-hide::-webkit-scrollbar {
          display: none;
        }
      `}</style>
    </div>
  );
};

export default AutoRotatingCarousel;
