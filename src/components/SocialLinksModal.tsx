import { useEffect } from 'react';
import { X, Github, Linkedin, Mail, Twitter } from 'lucide-react';
import { Link } from 'react-router-dom';
import socialLinks from '../data/social.json';

interface SocialLinksModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  github: Github,
  linkedin: Linkedin,
  mail: Mail,
  twitter: Twitter,
};

const SocialLinksModal = ({ isOpen, onClose }: SocialLinksModalProps) => {
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-end p-4 bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-[#001F3F] rounded-lg shadow-2xl w-full max-w-sm mt-16 mr-4 border border-[#001F3F]/10 dark:border-white/10"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex justify-between items-center p-4 border-b border-[#001F3F]/10 dark:border-white/10">
          <h2 className="text-lg font-semibold text-[#001F3F] dark:text-white">Links</h2>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-[#001F3F]/5 dark:hover:bg-white/5 transition-colors"
            aria-label="Close modal"
          >
            <X className="w-5 h-5 text-[#001F3F] dark:text-white" />
          </button>
        </div>

        {/* Navigation Links */}
        <div className="p-4 border-b border-[#001F3F]/10 dark:border-white/10">
          <nav className="flex flex-col space-y-2">
            {[
              { to: '/', label: 'Home' },
              { to: '/projects', label: 'Projects' },
              { to: '/blog', label: 'Blog' },
              { to: '/apps', label: 'Apps' },
              { to: '/about', label: 'About' },
            ].map((link) => (
              <Link
                key={link.to}
                to={link.to}
                onClick={onClose}
                className="px-4 py-2 rounded-lg text-[#001F3F] dark:text-white hover:bg-[#001F3F]/5 dark:hover:bg-white/5 transition-colors text-left"
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>

        {/* Social Links */}
        <div className="p-4">
          <h3 className="text-sm font-medium text-[#001F3F]/60 dark:text-white/60 mb-3">
            Connect
          </h3>
          <div className="flex flex-col space-y-2">
            {socialLinks.map((link) => {
              const Icon = iconMap[link.icon] || Mail;
              return (
                <a
                  key={link.name}
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center space-x-3 px-4 py-2 rounded-lg text-[#001F3F] dark:text-white hover:bg-[#001F3F]/5 dark:hover:bg-white/5 transition-colors"
                >
                  <Icon className="w-5 h-5" />
                  <span>{link.name}</span>
                </a>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

export default SocialLinksModal;
