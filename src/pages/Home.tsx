import { Link } from 'react-router-dom';
import { ArrowRight, Code, Briefcase, BookOpen } from 'lucide-react';
import { motion } from 'framer-motion';

const Home = () => {
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

          {/* CTA Buttons */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="flex flex-wrap justify-center gap-4 pt-4"
          >
            <Link
              to="/projects"
              className="inline-flex items-center space-x-2 px-8 py-4 bg-[#001F3F] dark:bg-white text-white dark:text-[#001F3F] rounded-lg hover:opacity-80 transition-all duration-300 font-medium text-lg group"
            >
              <Code className="w-5 h-5" />
              <span>View Projects</span>
              <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
            </Link>

            <Link
              to="/blog"
              className="inline-flex items-center space-x-2 px-8 py-4 border-2 border-[#001F3F] dark:border-white text-[#001F3F] dark:text-white rounded-lg hover:bg-[#001F3F]/5 dark:hover:bg-white/5 transition-all duration-300 font-medium text-lg group"
            >
              <BookOpen className="w-5 h-5" />
              <span>Read Blog</span>
              <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
            </Link>

            <Link
              to="/apps"
              className="inline-flex items-center space-x-2 px-8 py-4 border-2 border-[#001F3F] dark:border-white text-[#001F3F] dark:text-white rounded-lg hover:bg-[#001F3F]/5 dark:hover:bg-white/5 transition-all duration-300 font-medium text-lg group"
            >
              <Briefcase className="w-5 h-5" />
              <span>My Apps</span>
              <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
            </Link>
          </motion.div>
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
