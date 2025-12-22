import { motion } from 'framer-motion';
import { Briefcase, GraduationCap, Award, Heart } from 'lucide-react';
import { usePageAnalytics } from '../hooks/usePageAnalytics';

const About = () => {
  // Track page analytics
  usePageAnalytics('About');

  const experiences = [
    {
      title: 'Software Engineer',
      company: 'Google (via Tata Consultancy Services)',
      location: 'San Jose, CA',
      period: 'June 2021 – December 2023',
      responsibilities: [
        'To solve stakeholder analytics, built TensorFlow and MySQL chatbot with NLP and 500+ training dataset connecting to near real-time secure backend data, delivering precise insights and real-time data access to stakeholders.',
        'To facilitate data annotators, built Google Voice Command Classifier with React, Redux, and Cloud SQL. Implemented pagination and state management functionality, enabling 10,000+ voice commands to be classified.',
        'To modernize Google Search, completed 10+ Google Search Frontend Migration Projects with Typescript, HTML/CSS and Visual Regression Testing. Worked as technical liaison between client stakeholders and mgmt, delivering consistent UI/UX migrations, 200+ production code changes and 700+ code reviews.',
      ],
    },
  ];

  const skills = {
    'AI/ML': ['AWS Bedrock', 'LangChain', 'PyTorch', 'TensorFlow', 'Pinecone'],
    'Cloud & DevOps': ['AWS Lambda', 'SageMaker', 'CloudFormation', 'Docker', 'Kubernetes'],
    'Frontend': ['React', 'TypeScript', 'Next.js', 'TailwindCSS', 'Vite'],
    'Backend': ['Node.js', 'Python', 'FastAPI', 'Express', 'PostgreSQL'],
  };

  const certifications = [
    'AWS DevOps Professional',
    'AWS Developer Associate',
    'AWS Cloud Practitioner',
    'Deeplearning.AI Finetuning Large Language Models',
    'MongoDB Building RAG Apps',
  ];

  return (
    <div className="min-h-screen">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-20">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="text-center mb-16"
        >
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-[#001F3F] dark:text-white mb-4">
            About Me
          </h1>
          <p className="text-lg sm:text-xl text-[#001F3F]/70 dark:text-white/70 max-w-2xl mx-auto">
            Software engineer building scalable Agentic AI Systems and Platforms
          </p>
        </motion.div>

        {/* Bio */}
        <motion.section
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="mb-16"
        >
          {/* <div className="prose prose-lg prose-navy dark:prose-invert max-w-none">
            <p className="text-[#001F3F]/80 dark:text-white/80 text-lg leading-relaxed">
              I'm a software engineer with 2 YOE at Google via Tata Consultancy Services, currently building scalable production level Agentic AI / AI Platforms. I have a Computer Science B.S. from Rutgers University. 
            </p>
            <p className="text-[#001F3F]/80 dark:text-white/80 text-lg leading-relaxed mt-4">
              I combine Agentic AI designs + DevOps monitoring skills
            </p>
          </div> */}
          <div className="prose prose-lg prose-navy dark:prose-invert max-w-none">
            <p className="text-[#001F3F]/80 dark:text-white/80 text-lg leading-relaxed">
              I'm an AI Engineer building reproducible, scalable AI systems with 2+ years of experience at Google Search via Tata Consultancy Services, where I delivered 200+ production code changes. I hold a Computer Science B.S. from Rutgers University and am AWS DevOps Professional certified.
            </p>
            <p className="text-[#001F3F]/80 dark:text-white/80 text-lg leading-relaxed mt-4">
              I specialize in bridging Cloud infrastructure (Lambda, EKS, Bedrock) with Agentic AI systems (LangChain, RAG, Vector DBs, finetuning) to deliver production-ready AI platforms. I've also published an iOS app to the App Store, demonstrating full-stack development capabilities.
            </p>
          </div>
        </motion.section>

        {/* Experience Timeline */}
        <motion.section
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="mb-16"
        >
          <div className="flex items-center space-x-3 mb-8">
            <Briefcase className="w-6 h-6 text-[#001F3F] dark:text-white" />
            <h2 className="text-3xl font-bold text-[#001F3F] dark:text-white">Experience</h2>
          </div>
          <div className="space-y-6">
            {experiences.map((exp, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, x: -20 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: index * 0.1 }}
                className="border-l-4 border-[#001F3F] dark:border-white pl-6 py-2"
              >
                <h3 className="text-xl font-bold text-[#001F3F] dark:text-white">{exp.title}</h3>
                <p className="text-[#001F3F]/70 dark:text-white/70 font-medium">{exp.company}</p>
                <p className="text-[#001F3F]/60 dark:text-white/60 text-sm">{exp.period}</p>
                <p className="text-[#001F3F]/60 dark:text-white/60 text-sm">{exp.location}</p>
                <ul className="mt-3 space-y-2">
                  {exp.responsibilities.map((responsibility, idx) => (
                    <li key={idx} className="text-[#001F3F]/70 dark:text-white/70 text-sm flex">
                      <span className="mr-2">•</span>
                      <span>{responsibility}</span>
                    </li>
                  ))}
                </ul>
              </motion.div>
            ))}
          </div>
        </motion.section>

        {/* Education */}
        <motion.section
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="mb-16"
        >
          <div className="flex items-center space-x-3 mb-8">
            <GraduationCap className="w-6 h-6 text-[#001F3F] dark:text-white" />
            <h2 className="text-3xl font-bold text-[#001F3F] dark:text-white">Education</h2>
          </div>
          <div className="border-l-4 border-[#001F3F] dark:border-white pl-6 py-2">
            <h3 className="text-xl font-bold text-[#001F3F] dark:text-white">
              Bachelor of Science in Computer Science
            </h3>
            <p className="text-[#001F3F]/70 dark:text-white/70 font-medium">Rutgers University</p>
            <p className="text-[#001F3F]/60 dark:text-white/60 text-sm">Class of 2021</p>
          </div>
        </motion.section>

        {/* Skills */}
        <motion.section
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="mb-16"
        >
          <div className="flex items-center space-x-3 mb-8">
            <Award className="w-6 h-6 text-[#001F3F] dark:text-white" />
            <h2 className="text-3xl font-bold text-[#001F3F] dark:text-white">Skills</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {Object.entries(skills).map(([category, items]) => (
              <motion.div
                key={category}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5 }}
                className="bg-white dark:bg-[#001F3F] border border-[#001F3F]/10 dark:border-white/10 rounded-lg p-6"
              >
                <h3 className="text-lg font-bold text-[#001F3F] dark:text-white mb-3">{category}</h3>
                <div className="flex flex-wrap gap-2">
                  {items.map((skill) => (
                    <span
                      key={skill}
                      className="px-3 py-1 text-sm rounded-full bg-[#001F3F]/10 dark:bg-white/10 text-[#001F3F] dark:text-white"
                    >
                      {skill}
                    </span>
                  ))}
                </div>
              </motion.div>
            ))}
          </div>
        </motion.section>

        {/* Certifications */}
        <motion.section
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="mb-16"
        >
          <div className="flex items-center space-x-3 mb-8">
            <Award className="w-6 h-6 text-[#001F3F] dark:text-white" />
            <h2 className="text-3xl font-bold text-[#001F3F] dark:text-white">Certifications</h2>
          </div>
          <ul className="space-y-3">
            {certifications.map((cert, index) => (
              <motion.li
                key={index}
                initial={{ opacity: 0, x: -20 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: index * 0.1 }}
                className="flex items-center space-x-3 text-[#001F3F] dark:text-white"
              >
                <span className="text-[#001F3F] dark:text-white">✓</span>
                <span>{cert}</span>
              </motion.li>
            ))}
          </ul>
        </motion.section>

        {/* Personal */}
        <motion.section
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
        >
          <div className="flex items-center space-x-3 mb-8">
            <Heart className="w-6 h-6 text-[#001F3F] dark:text-white" />
            <h2 className="text-3xl font-bold text-[#001F3F] dark:text-white">Personal Interests</h2>
          </div>
          <p className="text-[#001F3F]/80 dark:text-white/80 text-lg">
            Outside of AI dev, I enjoy running (multiple 10Ks), playing Quadball with Silicon Valley Vipers, and reading Classic Fiction / Tech Documentation.
          </p>
        </motion.section>
      </div>
    </div>
  );
};

export default About;
