# Personal Portfolio Website

A modern, responsive personal portfolio website built with React, TypeScript, TailwindCSS, and deployed on Cloudflare Pages.

## Features

- **Dark Mode**: Smooth theme switching with localStorage persistence
- **Responsive Design**: Mobile-first approach, works beautifully on all devices
- **Smooth Animations**: Framer Motion powered scroll animations and transitions
- **Fast Performance**: Built with Vite for lightning-fast development and builds
- **SEO Friendly**: Optimized for search engines
- **Navy/White Theme**: Clean, professional color scheme

## Tech Stack

- **Framework**: React 18 with TypeScript
- **Build Tool**: Vite
- **Styling**: TailwindCSS with custom navy/white theme
- **Routing**: React Router v6
- **Animations**: Framer Motion
- **Icons**: Lucide React
- **Deployment**: Cloudflare Pages

## Project Structure

```
portfolio/
├── src/
│   ├── components/          # Reusable UI components
│   │   ├── Header.tsx
│   │   ├── Footer.tsx
│   │   ├── SocialLinksModal.tsx
│   │   ├── ProjectCard.tsx
│   │   ├── BlogCard.tsx
│   │   └── AppCard.tsx
│   ├── pages/              # Page components
│   │   ├── Home.tsx
│   │   ├── Projects.tsx
│   │   ├── Blog.tsx
│   │   ├── BlogPost.tsx
│   │   ├── Apps.tsx
│   │   └── About.tsx
│   ├── data/               # JSON data files
│   │   ├── projects.json
│   │   ├── blogs.json
│   │   ├── apps.json
│   │   └── social.json
│   ├── hooks/              # Custom React hooks
│   │   └── useDarkMode.tsx
│   ├── types/              # TypeScript type definitions
│   │   └── index.ts
│   ├── App.tsx
│   ├── main.tsx
│   └── index.css
└── public/
    └── _redirects         # Cloudflare Pages routing config
```

## Getting Started

### Prerequisites

- Node.js 18+
- npm or yarn

### Installation

1. Clone the repository:
```bash
git clone https://github.com/MacAndPC/portfolio.git
cd portfolio
```

2. Install dependencies:
```bash
npm install
```

3. Start the development server:
```bash
npm run dev
```

The site will be available at `http://localhost:5173`

### Building for Production

```bash
npm run build
```

The build output will be in the `dist` directory.

### Preview Production Build

```bash
npm run preview
```

## Customization

### Update Personal Information

1. **Data Files**: Edit JSON files in `src/data/`:
   - `projects.json`: Your projects with YouTube videos, GitHub links, tech stack
   - `blogs.json`: Blog posts with content, dates, and tags
   - `apps.json`: Your applications with features and store links
   - `social.json`: Your social media and contact links

2. **About Page**: Edit `src/pages/About.tsx` to update:
   - Bio and introduction
   - Work experience
   - Education
   - Skills
   - Certifications
   - Personal interests

3. **Site Name**: Update "MacAndPC" in `src/components/Header.tsx` and `src/components/Footer.tsx`

### Adding YouTube Videos

In `projects.json`, add the YouTube video ID (the part after `v=` in the URL):

```json
{
  "youtubeId": "dQw4w9WgXcQ"
}
```

Leave empty or omit if no video is available.

### Color Customization

The navy/white theme is configured in `src/index.css`. To change colors:

```css
:root {
  --color-navy: #001F3F;  /* Change this for different navy shade */
  --color-white: #FFFFFF;
}
```

## Deployment to Cloudflare Pages

### Option 1: GitHub Integration (Recommended)

1. Push your code to GitHub
2. Go to [Cloudflare Pages](https://pages.cloudflare.com/)
3. Click "Create a project" → "Connect to Git"
4. Select your repository
5. Configure build settings:
   - **Build command**: `npm run build`
   - **Build output directory**: `dist`
   - **Root directory**: `/`
6. Click "Save and Deploy"

### Option 2: Direct Upload

1. Build the project:
```bash
npm run build
```

2. Install Wrangler CLI:
```bash
npm install -g wrangler
```

3. Deploy:
```bash
wrangler pages deploy dist
```

### Environment Variables

No environment variables are required for the basic setup. If you add features requiring API keys or secrets, add them in the Cloudflare Pages dashboard under Settings → Environment variables.

### Custom Domain

1. In Cloudflare Pages dashboard, go to your project
2. Navigate to "Custom domains"
3. Add your domain and follow the DNS configuration instructions

## Performance Optimization

The site is optimized for performance with:

- Lazy loading for images and YouTube embeds
- Code splitting by route
- Framer Motion viewport optimization
- Smooth scroll and transitions
- Minimal bundle size

Expected Lighthouse scores: 90+ across all metrics

## Browser Support

- Chrome/Edge (latest)
- Firefox (latest)
- Safari (latest)
- Mobile browsers (iOS Safari, Chrome Android)

## License

MIT License - feel free to use this template for your own portfolio!

## Credits

Built by MacAndPC using:
- [React](https://react.dev/)
- [Vite](https://vitejs.dev/)
- [TailwindCSS](https://tailwindcss.com/)
- [Framer Motion](https://www.framer.com/motion/)
- [Lucide Icons](https://lucide.dev/)
