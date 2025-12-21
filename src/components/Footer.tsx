import { Github, Linkedin, Mail, Twitter } from 'lucide-react';
import socialLinks from '../data/social.json';

const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  github: Github,
  linkedin: Linkedin,
  mail: Mail,
  twitter: Twitter,
};

const Footer = () => {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="bg-white dark:bg-[#001F3F] border-t border-[#001F3F]/10 dark:border-white/10 mt-auto">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex flex-col items-center space-y-4">
          {/* Social Links */}
          <div className="flex space-x-6">
            {socialLinks.map((link) => {
              const Icon = iconMap[link.icon] || Mail;
              return (
                <a
                  key={link.name}
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[#001F3F] dark:text-white hover:opacity-70 transition-opacity"
                  aria-label={link.name}
                >
                  <Icon className="w-5 h-5" />
                </a>
              );
            })}
          </div>

          {/* Copyright */}
          <p className="text-sm text-[#001F3F]/60 dark:text-white/60">
            {currentYear} Nikhil Kulkarni. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
