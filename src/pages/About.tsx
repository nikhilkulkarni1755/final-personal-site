import { motion } from 'framer-motion';
import { Briefcase, GraduationCap, Award, Heart } from 'lucide-react';

const About = () => {
  const experiences = [
    {
      title: 'Software Engineer',
      company: 'Google',
      period: '2022 - 2023',
      description: 'Worked on cloud infrastructure and distributed systems',
    },
    {
      title: 'Software Engineer',
      company: 'Tata Consultancy Services (TCS)',
      period: '2020 - 2022',
      description: 'Full-stack development and enterprise solutions',
    },
  ];

  const skills = {
    'AI/ML': ['AWS Bedrock', 'LangChain', 'PyTorch', 'TensorFlow', 'Pinecone'],
    'Cloud & DevOps': ['AWS Lambda', 'SageMaker', 'CloudFormation', 'Docker', 'Kubernetes'],
    'Frontend': ['React', 'TypeScript', 'Next.js', 'TailwindCSS', 'Vite'],
    'Backend': ['Node.js', 'Python', 'FastAPI', 'Express', 'PostgreSQL'],
  };

  const certifications = [
    'AWS Certified Solutions Architect',
    'AWS Certified Developer',
    'Machine Learning Specialization',
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
            Software engineer passionate about building AI-powered solutions
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
          <div className="prose prose-lg prose-navy dark:prose-invert max-w-none">
            <p className="text-[#001F3F]/80 dark:text-white/80 text-lg leading-relaxed">
              I'm a software engineer with experience at Google and TCS, currently pursuing my passion
              for building AI-powered applications and cloud infrastructure solutions. I hold a Computer
              Science degree from Rutgers University and have AWS certifications in cloud architecture
              and development.
            </p>
            <p className="text-[#001F3F]/80 dark:text-white/80 text-lg leading-relaxed mt-4">
              My work focuses on combining cutting-edge AI/ML technologies with scalable cloud
              infrastructure to create practical solutions. I specialize in building RAG systems,
              serverless applications, and full-stack web platforms.
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
                <p className="text-[#001F3F]/70 dark:text-white/70 mt-2">{exp.description}</p>
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
            <p className="text-[#001F3F]/60 dark:text-white/60 text-sm">Class of 2020</p>
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
            Outside of coding, I maintain a daily running streak and enjoy exploring new technologies
            and frameworks. I'm passionate about continuous learning and staying current with the
            latest developments in AI and cloud computing.
          </p>
        </motion.section>
      </div>
    </div>
  );
};

export default About;
