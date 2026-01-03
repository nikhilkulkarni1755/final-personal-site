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

// ============================================================================
// Drug Marketplace Types
// ============================================================================

export type Drug = {
  id: string;
  name: string;
  description: string;
  price: number;
  stock: number;
  diseases_treated: string[];
  side_effects: string[];
  created_at: string;
  updated_at: string;
}

export type MarketplaceUser = {
  id: string;
  user_id: string;
  token_balance: number;
  created_at: string;
  updated_at: string;
}

export type Purchase = {
  id: string;
  user_id: string;
  drug_id: string;
  quantity: number;
  total_cost: number;
  purchase_date: string;
}

export type PurchaseWithDrug = Purchase & {
  drugs: {
    name: string;
    description: string;
    price: number;
  } | null;
}
