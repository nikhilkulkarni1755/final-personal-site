import { useState } from 'react';
import { ExternalLink, Github } from 'lucide-react';
import type { Project } from '../types';
import { motion } from 'framer-motion';

interface ProjectCardProps {
  project: Project;
  index: number;
}

const ProjectCard = ({ project, index }: ProjectCardProps) => {
  const isReversed = index % 2 !== 0;
  const hasYoutube = project.youtubeId && project.youtubeId.trim() !== '';
  const demos = project.demos ?? [];
  const [activeDemo, setActiveDemo] = useState(0);
  const hasVideo = hasYoutube || demos.length > 0;

  return (
    <motion.div
      id={project.title.toLowerCase().replace(/\s+/g, '-')}
      initial={{ opacity: 0, y: 50 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-100px' }}
      transition={{ duration: 0.5, delay: 0.1 }}
      className={`scroll-mt-24 flex flex-col ${
        isReversed ? 'lg:flex-row-reverse' : 'lg:flex-row'
      } gap-6 lg:gap-12 items-center`}
    >
      {/* Video/Media */}
      {hasVideo && (
        <div className="w-full lg:w-1/2">
          {demos.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-3">
              {demos.map((demo, i) => (
                <button
                  key={demo.label}
                  onClick={() => setActiveDemo(i)}
                  className={`px-3 py-1.5 rounded-lg text-sm whitespace-nowrap transition-all duration-300 ${
                    i === activeDemo
                      ? 'bg-[#001F3F] dark:bg-white text-white dark:text-[#001F3F]'
                      : 'border border-[#001F3F]/20 dark:border-white/20 text-[#001F3F]/70 dark:text-white/70 hover:border-[#001F3F] dark:hover:border-white'
                  }`}
                >
                  {demo.label}
                </button>
              ))}
            </div>
          )}
          <div className="aspect-video rounded-lg overflow-hidden shadow-lg border border-[#001F3F]/10 dark:border-white/10">
            {demos.length > 0 ? (
              <video
                key={demos[activeDemo].src}
                src={demos[activeDemo].src}
                poster={demos[activeDemo].poster}
                controls
                preload="none"
                className="w-full h-full bg-black"
              />
            ) : (
              <iframe
                src={`https://www.youtube.com/embed/${project.youtubeId}`}
                title={project.title}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                loading="lazy"
                className="w-full h-full"
              />
            )}
          </div>
        </div>
      )}

      {/* Content */}
      <div className={`w-full ${hasVideo ? 'lg:w-1/2' : ''} space-y-4`}>
        <h3 className="text-2xl sm:text-3xl font-bold text-[#001F3F] dark:text-white">
          {project.title}
        </h3>
        <p className="text-[#001F3F]/70 dark:text-white/70 text-base sm:text-lg">
          {project.description}
        </p>

        {/* Tech Stack */}
        <div className="flex flex-wrap gap-2">
          {project.techStack.map((tech) => (
            <span
              key={tech}
              className="px-3 py-1 text-sm rounded-full bg-[#001F3F]/10 dark:bg-white/10 text-[#001F3F] dark:text-white"
            >
              {tech}
            </span>
          ))}
        </div>

        {/* Links */}
        <div className="flex flex-wrap gap-3">
          {project.liveUrl && (
            <a
              href={project.liveUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center space-x-2 px-6 py-3 bg-[#001F3F] dark:bg-white text-white dark:text-[#001F3F] rounded-lg hover:opacity-80 transition-opacity font-medium"
            >
              <span>Connect to Claude</span>
              <ExternalLink className="w-4 h-4" />
            </a>
          )}
          {project.github && (
            <a
              href={project.github}
              target="_blank"
              rel="noopener noreferrer"
              className={`inline-flex items-center space-x-2 px-6 py-3 rounded-lg hover:opacity-80 transition-opacity font-medium ${
                project.liveUrl
                  ? 'border border-[#001F3F] dark:border-white text-[#001F3F] dark:text-white'
                  : 'bg-[#001F3F] dark:bg-white text-white dark:text-[#001F3F]'
              }`}
            >
              <Github className="w-5 h-5" />
              <span>View on GitHub</span>
            </a>
          )}
        </div>
      </div>
    </motion.div>
  );
};

export default ProjectCard;
