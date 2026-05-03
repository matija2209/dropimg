import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
import { Sun, Moon } from 'lucide-react';
import { Uploader } from './components/Uploader';
import { Gallery } from './components/Gallery';
import { ImagePreview } from './components/ImagePreview';

const APP_NAME = import.meta.env.VITE_APP_NAME || 'DropImg';

function App() {
  const [isDark, setIsDark] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('theme');
      if (saved) return saved === 'dark';
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    return false;
  });

  useEffect(() => {
    document.title = APP_NAME;
  }, []);

  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add('dark');
      document.documentElement.style.colorScheme = 'dark';
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      document.documentElement.style.colorScheme = 'light';
      localStorage.setItem('theme', 'light');
    }
  }, [isDark]);

  const toggleTheme = () => setIsDark(!isDark);

  return (
    <BrowserRouter>
      <div className="min-h-screen w-full bg-gray-50 dark:bg-gray-950 flex flex-col items-center py-12 px-4 transition-colors duration-300">
        <header className="mb-12 text-center w-full max-w-6xl relative">
          <div className="absolute right-0 top-1/2 -translate-y-1/2">
             <button 
               onClick={toggleTheme}
               className="p-2 rounded-full bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-all shadow-sm"
               aria-label="Toggle theme"
             >
               {isDark ? <Sun size={20} /> : <Moon size={20} />}
             </button>
          </div>
          
          <Link to="/" className="inline-block">
            <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-2 tracking-tight">
              {APP_NAME === 'DropImg' ? (
                <>Drop<span className="text-blue-600">Img</span></>
              ) : (
                APP_NAME
              )}
            </h1>
          </Link>
          <p className="text-gray-600 dark:text-gray-400 mx-auto max-w-md">
            Simple, fast, and private image hosting.
          </p>

          <nav className="mt-6 flex justify-center gap-6">
            <Link to="/" className="text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition">
              Upload
            </Link>
            <Link to="/assets" className="text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition">
              Gallery
            </Link>
          </nav>
        </header>

        <main className="w-full flex justify-center">
          <Routes>
            <Route path="/" element={<Uploader />} />
            <Route path="/assets" element={<Gallery />} />
            <Route path="/i/:id" element={<ImagePreview />} />
          </Routes>
        </main>

        <footer className="mt-auto pt-12 text-gray-500 dark:text-gray-400 text-sm text-center">
          <p className="mb-2">© {new Date().getFullYear()} {APP_NAME} • Open Source</p>
          <p>
            Build with ❤️ by{' '}
            <a 
              href="https://buildwithmatija.com/" 
              target="_blank" 
              rel="noopener noreferrer"
              className="font-medium hover:text-blue-600 dark:hover:text-blue-400 transition"
            >
              buildwithmatija.com
            </a>
          </p>
        </footer>
      </div>
    </BrowserRouter>
  );
}

export default App;
