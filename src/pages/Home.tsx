import { Link } from 'react-router-dom';
import { ArrowRight, ExternalLink } from 'lucide-react';
import { motion } from 'framer-motion';
import { useEffect } from 'react';
import AutoRotatingCarousel from '../components/AutoRotatingCarousel';
import projectsData from '../data/projects.json';
import blogsData from '../data/blogs.json';
import appsData from '../data/apps.json';
import type { Project, BlogPost, App } from '../types';

const Home = () => {
  const projects = projectsData as Project[];
  const blogs = blogsData as BlogPost[];
  const apps = appsData as App[];

  useEffect(() => {
    // Load Credly embed script
    const script = document.createElement('script');
    script.src = '//cdn.credly.com/assets/utilities/embed.js';
    script.async = true;
    document.body.appendChild(script);

    return () => {
      // Cleanup script on unmount
      if (document.body.contains(script)) {
        document.body.removeChild(script);
      }
    };
  }, []);

  const renderProject = (project: Project) => (
    <div className="flex flex-col items-center text-center space-y-4">
      <h3 className="text-2xl font-bold text-[#001F3F] dark:text-white">
        {project.title}
      </h3>
      <p className="text-[#001F3F]/70 dark:text-white/70 max-w-2xl">
        {project.description}
      </p>
      <div className="flex flex-wrap gap-2 justify-center">
        {project.techStack.map((tech) => (
          <span
            key={tech}
            className="px-3 py-1 bg-[#001F3F]/10 dark:bg-white/10 text-[#001F3F] dark:text-white rounded-full text-sm"
          >
            {tech}
          </span>
        ))}
      </div>
      <div className="flex gap-4">
        <a
          href={project.github}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center space-x-2 px-6 py-3 bg-[#001F3F] dark:bg-white text-white dark:text-[#001F3F] rounded-lg hover:opacity-80 transition-all duration-300"
        >
          <span>View on GitHub</span>
          <ExternalLink className="w-4 h-4" />
        </a>
      </div>
    </div>
  );

  const renderBlog = (blog: BlogPost) => (
    <div className="flex flex-col items-center text-center space-y-4">
      <h3 className="text-2xl font-bold text-[#001F3F] dark:text-white">
        {blog.title}
      </h3>
      <p className="text-[#001F3F]/70 dark:text-white/70 max-w-2xl">
        {blog.excerpt}
      </p>
      <div className="flex flex-wrap gap-2 justify-center">
        {blog.tags.map((tag) => (
          <span
            key={tag}
            className="px-3 py-1 bg-[#001F3F]/10 dark:bg-white/10 text-[#001F3F] dark:text-white rounded-full text-sm"
          >
            {tag}
          </span>
        ))}
      </div>
      <div className="flex items-center gap-4 text-sm text-[#001F3F]/60 dark:text-white/60">
        <span>{blog.publishDate}</span>
        <span>•</span>
        <span>{blog.readTime} min read</span>
      </div>
      <Link
        to={`/blog/${blog.slug}`}
        className="inline-flex items-center space-x-2 px-6 py-3 bg-[#001F3F] dark:bg-white text-white dark:text-[#001F3F] rounded-lg hover:opacity-80 transition-all duration-300"
      >
        <span>Read Article</span>
        <ArrowRight className="w-4 h-4" />
      </Link>
    </div>
  );

  const renderApp = (app: App) => (
    <div className="flex flex-col items-center text-center space-y-4">
      <h3 className="text-2xl font-bold text-[#001F3F] dark:text-white">
        {app.title}
      </h3>
      <p className="text-[#001F3F]/70 dark:text-white/70 max-w-2xl">
        {app.description}
      </p>
      <ul className="text-left text-[#001F3F]/70 dark:text-white/70 space-y-2">
        {app.features.slice(0, 3).map((feature, idx) => (
          <li key={idx} className="flex items-start">
            <span className="mr-2">•</span>
            <span>{feature}</span>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2 justify-center">
        {app.techStack.map((tech) => (
          <span
            key={tech}
            className="px-3 py-1 bg-[#001F3F]/10 dark:bg-white/10 text-[#001F3F] dark:text-white rounded-full text-sm"
          >
            {tech}
          </span>
        ))}
      </div>
      <div className="flex gap-4">
        {app.appStoreLink && (
          <a
            href={app.appStoreLink}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center space-x-2 px-6 py-3 bg-[#001F3F] dark:bg-white text-white dark:text-[#001F3F] rounded-lg hover:opacity-80 transition-all duration-300"
          >
            <span>App Store</span>
            <ExternalLink className="w-4 h-4" />
          </a>
        )}
        {app.playStoreLink && (
          <a
            href={app.playStoreLink}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center space-x-2 px-6 py-3 bg-[#001F3F] dark:bg-white text-white dark:text-[#001F3F] rounded-lg hover:opacity-80 transition-all duration-300"
          >
            <span>Play Store</span>
            <ExternalLink className="w-4 h-4" />
          </a>
        )}
        {app.demoLink && (
          <a
            href={app.demoLink}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center space-x-2 px-6 py-3 border-2 border-[#001F3F] dark:border-white text-[#001F3F] dark:text-white rounded-lg hover:bg-[#001F3F]/5 dark:hover:bg-white/5 transition-all duration-300"
          >
            <span>View Demo</span>
            <ExternalLink className="w-4 h-4" />
          </a>
        )}
      </div>
    </div>
  );

  return (
    <div className="min-h-[calc(100vh-4rem)]">
      {/* Hero Section */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 sm:py-32">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="text-center space-y-8"
        >
          {/* Main Heading */}
          <h1 className="text-4xl sm:text-5xl lg:text-7xl font-bold text-[#001F3F] dark:text-white">
            Building AI-Powered
            <br />
            <span className="bg-gradient-to-r from-[#001F3F] to-[#001F3F]/60 dark:from-white dark:to-white/60 bg-clip-text text-transparent">
              Solutions
            </span>
          </h1>

          {/* Subtitle */}
          <p className="text-lg sm:text-xl lg:text-2xl text-[#001F3F]/70 dark:text-white/70 max-w-3xl mx-auto">
            Software Engineer specializing in AI/ML, cloud infrastructure, and full-stack development.
            Previously at Google and TCS.
          </p>
        </motion.div>
      </section>

      {/* Auto-Rotating Content Sections */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-16 space-y-12">
        {/* Projects Row */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
        >
          <AutoRotatingCarousel
            items={projects}
            renderItem={renderProject}
            title="Featured Projects"
            interval={5000}
          />
        </motion.div>

        {/* Blog Articles Row */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 0.1 }}
        >
          <AutoRotatingCarousel
            items={blogs}
            renderItem={renderBlog}
            title="Latest Articles"
            interval={5000}
          />
        </motion.div>

        {/* Apps Row */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 0.2 }}
        >
          <AutoRotatingCarousel
            items={apps}
            renderItem={renderApp}
            title="My Apps"
            interval={5000}
          />
        </motion.div>

        {/* Certifications Row */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 0.3 }}
        >
          <h2 className="text-2xl sm:text-3xl font-bold text-[#001F3F] dark:text-white mb-6">
            Certifications
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            <div
              data-iframe-width="150"
              data-iframe-height="270"
              data-share-badge-id="9cbb98e9-0ea9-4b52-979e-b4a966e1dae8"
              data-share-badge-host="https://www.credly.com"
              className="flex justify-center"
            />
            <div
              data-iframe-width="150"
              data-iframe-height="270"
              data-share-badge-id="e60bdb2b-dcc0-4dca-999d-854361ddc0df"
              data-share-badge-host="https://www.credly.com"
              className="flex justify-center"
            />
            <div
              data-iframe-width="150"
              data-iframe-height="270"
              data-share-badge-id="8c54612a-4171-496a-ad63-abed4867325b"
              data-share-badge-host="https://www.credly.com"
              className="flex justify-center"
            />
            <div
              data-iframe-width="150"
              data-iframe-height="270"
              data-share-badge-id="415d68cd-8a32-4a59-8bc2-b0e6418b37f4"
              data-share-badge-host="https://www.credly.com"
              className="flex justify-center"
            />
          </div>
        </motion.div>
      </section>

      {/* Featured Section */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="grid grid-cols-1 md:grid-cols-3 gap-8"
        >
          {[
            {
              title: 'AI/ML Engineering',
              description: 'Building intelligent systems with AWS Bedrock, LangChain, and custom ML models',
              icon: '🤖',
            },
            {
              title: 'Cloud Architecture',
              description: 'Designing scalable solutions on AWS with serverless and containerized deployments',
              icon: '☁️',
            },
            {
              title: 'Full-Stack Development',
              description: 'Creating modern web applications with React, TypeScript, and Node.js',
              icon: '💻',
            },
          ].map((item, index) => (
            <motion.div
              key={item.title}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: index * 0.1 }}
              className="p-6 bg-white dark:bg-[#001F3F] border border-[#001F3F]/10 dark:border-white/10 rounded-lg hover:shadow-lg transition-shadow"
            >
              <div className="text-4xl mb-4">{item.icon}</div>
              <h3 className="text-xl font-bold text-[#001F3F] dark:text-white mb-2">
                {item.title}
              </h3>
              <p className="text-[#001F3F]/70 dark:text-white/70">{item.description}</p>
            </motion.div>
          ))}
        </motion.div>
      </section>
    </div>
  );
};

export default Home;
