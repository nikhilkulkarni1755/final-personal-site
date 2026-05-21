import { BrowserRouter as Router, Routes, Route, useLocation } from 'react-router-dom';
import { ThemeProvider } from './hooks/useDarkMode';
import Header from './components/Header';
import Footer from './components/Footer';
import Home from './pages/Home';
import Projects from './pages/Projects';
import Blog from './pages/Blog';
import BlogPost from './pages/BlogPost';
import Apps from './pages/Apps';
import About from './pages/About';
import Privacy from './pages/Privacy';
import DrugMarketplace from './pages/DrugMarketplace';
import MatmulTutorial from './pages/MatmulTutorial';
import LinkedinAgentPost from './pages/LinkedinAgentPost';
import DockerSecretsPost from './pages/DockerSecretsPost';
import WeaveTakeHome from './pages/WeaveTakeHome';

function AppContent() {
  const location = useLocation();
  const isTakeHome = location.pathname.startsWith('/take-homes/');

  if (isTakeHome) {
    return (
      <Routes>
        <Route path="/take-homes/weave" element={<WeaveTakeHome />} />
      </Routes>
    );
  }

  return (
    <div className="flex flex-col min-h-screen">
      <Header />
      <main className="flex-grow">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/projects" element={<Projects />} />
          <Route path="/blog" element={<Blog />} />
          <Route path="/blog/matmul-to-ai" element={<MatmulTutorial />} />
          <Route path="/blog/linkedin-agent" element={<LinkedinAgentPost />} />
          <Route path="/blog/docker-secrets-injection" element={<DockerSecretsPost />} />
          <Route path="/blog/:slug" element={<BlogPost />} />
          <Route path="/apps" element={<Apps />} />
          <Route path="/about" element={<About />} />
          <Route path="/privacy-policy" element={<Privacy />} />
          <Route path="/spearfishing/voice-agent" element={<DrugMarketplace />} />
        </Routes>
      </main>
      <Footer />
    </div>
  );
}

function App() {
  return (
    <ThemeProvider>
      <Router>
        <AppContent />
      </Router>
    </ThemeProvider>
  );
}

export default App;
