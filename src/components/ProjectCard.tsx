import { Github } from 'lucide-react';
import type { Project } from '../types';
import { motion } from 'framer-motion';

interface ProjectCardProps {
  project: Project;
  index: number;
}

const ProjectCard = ({ project, index }: ProjectCardProps) => {
  const isReversed = index % 2 !== 0;
  const hasVideo = project.youtubeId && project.youtubeId.trim() !== '';

  return (
    <motion.div
      initial={{ opacity: 0, y: 50 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-100px' }}
      transition={{ duration: 0.5, delay: 0.1 }}
      className={`flex flex-col ${
        isReversed ? 'lg:flex-row-reverse' : 'lg:flex-row'
      } gap-6 lg:gap-12 items-center`}
    >
      {/* Video/Media */}
      {hasVideo && (
        <div className="w-full lg:w-1/2">
          <div className="aspect-video rounded-lg overflow-hidden shadow-lg border border-[#001F3F]/10 dark:border-white/10">
            <iframe
              src={`https://www.youtube.com/embed/${project.youtubeId}`}
              title={project.title}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              loading="lazy"
              className="w-full h-full"
            />
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

        {/* GitHub Link */}
        <a
          href={project.github}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center space-x-2 px-6 py-3 bg-[#001F3F] dark:bg-white text-white dark:text-[#001F3F] rounded-lg hover:opacity-80 transition-opacity font-medium"
        >
          <Github className="w-5 h-5" />
          <span>View on GitHub</span>
        </a>
      </div>
    </motion.div>
  );
};

export default ProjectCard;
