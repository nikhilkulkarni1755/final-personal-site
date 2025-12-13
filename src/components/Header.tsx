import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Moon, Sun, Menu } from 'lucide-react';
import { useTheme } from '../hooks/useDarkMode';
import SocialLinksModal from './SocialLinksModal';

const Header = () => {
  const { theme, toggleTheme } = useTheme();
  const [isModalOpen, setIsModalOpen] = useState(false);

  return (
    <>
      <header className="sticky top-0 z-50 bg-white/80 dark:bg-[#001F3F]/80 backdrop-blur-md border-b border-[#001F3F]/10 dark:border-white/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            {/* Left: Dark Mode Toggle */}
            <button
              onClick={toggleTheme}
              className="p-2 rounded-lg hover:bg-[#001F3F]/5 dark:hover:bg-white/5 transition-colors"
              aria-label="Toggle dark mode"
            >
              {theme === 'dark' ? (
                <Sun className="w-5 h-5 text-white" />
              ) : (
                <Moon className="w-5 h-5 text-[#001F3F]" />
              )}
            </button>

            {/* Center: Name/Logo */}
            <Link
              to="/"
              className="text-xl sm:text-2xl font-bold text-[#001F3F] dark:text-white hover:opacity-80 transition-opacity"
            >
              MacAndPC
            </Link>

            {/* Right: Menu Button */}
            <button
              onClick={() => setIsModalOpen(true)}
              className="p-2 rounded-lg hover:bg-[#001F3F]/5 dark:hover:bg-white/5 transition-colors"
              aria-label="Open menu"
            >
              <Menu className="w-5 h-5 text-[#001F3F] dark:text-white" />
            </button>
          </div>
        </div>
      </header>

      <SocialLinksModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} />
    </>
  );
};

export default Header;
