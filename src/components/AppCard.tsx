import { ExternalLink, Smartphone, Store } from 'lucide-react';
import type { App } from '../types';
import { motion } from 'framer-motion';

interface AppCardProps {
  app: App;
  index: number;
}

const AppCard = ({ app, index }: AppCardProps) => {
  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-50px' }}
      transition={{ duration: 0.4, delay: index * 0.1 }}
      className="bg-white dark:bg-[#001F3F] border border-[#001F3F]/10 dark:border-white/10 rounded-lg overflow-hidden hover:shadow-xl transition-all duration-300"
    >
      <div className="p-6 space-y-4">
        {/* Header */}
        <div className="flex items-start space-x-3">
          <div className="p-3 bg-[#001F3F]/10 dark:bg-white/10 rounded-lg">
            <Smartphone className="w-6 h-6 text-[#001F3F] dark:text-white" />
          </div>
          <div className="flex-1">
            <h3 className="text-xl sm:text-2xl font-bold text-[#001F3F] dark:text-white">
              {app.title}
            </h3>
          </div>
        </div>

        {/* Description */}
        <p className="text-[#001F3F]/70 dark:text-white/70">{app.description}</p>

        {/* Features */}
        <div>
          <h4 className="text-sm font-semibold text-[#001F3F] dark:text-white mb-2">
            Key Features:
          </h4>
          <ul className="space-y-1">
            {app.features.map((feature, idx) => (
              <li
                key={idx}
                className="text-sm text-[#001F3F]/70 dark:text-white/70 flex items-start"
              >
                <span className="text-[#001F3F] dark:text-white mr-2">•</span>
                {feature}
              </li>
            ))}
          </ul>
        </div>

        {/* Tech Stack */}
        <div className="flex flex-wrap gap-2">
          {app.techStack.map((tech) => (
            <span
              key={tech}
              className="px-3 py-1 text-sm rounded-full bg-[#001F3F]/10 dark:bg-white/10 text-[#001F3F] dark:text-white"
            >
              {tech}
            </span>
          ))}
        </div>

        {/* Links */}
        <div className="flex flex-wrap gap-3 pt-2">
          {app.appStoreLink && (
            <a
              href={app.appStoreLink}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center space-x-2 px-4 py-2 bg-[#001F3F] dark:bg-white text-white dark:text-[#001F3F] rounded-lg hover:opacity-80 transition-opacity text-sm font-medium"
            >
              <Store className="w-4 h-4" />
              <span>App Store</span>
            </a>
          )}
          {app.playStoreLink && (
            <a
              href={app.playStoreLink}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center space-x-2 px-4 py-2 bg-[#001F3F] dark:bg-white text-white dark:text-[#001F3F] rounded-lg hover:opacity-80 transition-opacity text-sm font-medium"
            >
              <Store className="w-4 h-4" />
              <span>Play Store</span>
            </a>
          )}
          {app.demoLink && (
            <a
              href={app.demoLink}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center space-x-2 px-4 py-2 border border-[#001F3F] dark:border-white text-[#001F3F] dark:text-white rounded-lg hover:bg-[#001F3F]/5 dark:hover:bg-white/5 transition-colors text-sm font-medium"
            >
              <ExternalLink className="w-4 h-4" />
              <span>Live Demo</span>
            </a>
          )}
        </div>
      </div>
    </motion.div>
  );
};

export default AppCard;
