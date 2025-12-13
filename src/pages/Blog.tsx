import { motion } from 'framer-motion';
import BlogCard from '../components/BlogCard';
import blogsData from '../data/blogs.json';
import type { BlogPost } from '../types';

const Blog = () => {
  const posts = blogsData as BlogPost[];

  return (
    <div className="min-h-screen">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-20">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="text-center mb-16"
        >
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-[#001F3F] dark:text-white mb-4">
            Blog
          </h1>
          <p className="text-lg sm:text-xl text-[#001F3F]/70 dark:text-white/70 max-w-2xl mx-auto">
            Thoughts on software engineering, AI/ML, and building products
          </p>
        </motion.div>

        {/* Blog Posts Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {posts.map((post, index) => (
            <BlogCard key={post.id} post={post} index={index} />
          ))}
        </div>
      </div>
    </div>
  );
};

export default Blog;
