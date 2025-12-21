export type Project = {
  id: number;
  title: string;
  description: string;
  youtubeId?: string;
  github: string;
  techStack: string[];
  image?: string;
}

export type BlogPost = {
  id: number;
  title: string;
  slug: string;
  subtitle: string;
  content: string;
  publishDate: string;
  readTime: number;
  featuredImage?: string;
  tags?: string[];
}

export type App = {
  id: number;
  title: string;
  description: string;
  features: string[];
  techStack: string[];
  appStoreLink?: string;
  playStoreLink?: string;
  demoLink?: string;
  images: string[];
}

export type SocialLink = {
  name: string;
  url: string;
  icon: string;
}
