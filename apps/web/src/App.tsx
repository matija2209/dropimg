import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
import { Uploader } from './components/Uploader';
import { Gallery } from './components/Gallery';
import { ImagePreview } from './components/ImagePreview';

function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen w-full bg-gray-50 dark:bg-gray-950 flex flex-col items-center py-12 px-4">
        <header className="mb-12 text-center w-full max-w-2xl relative">
          <div className="absolute left-0 top-1/2 -translate-y-1/2 flex gap-4">
             {/* Potential Nav if needed */}
          </div>
          
          <Link to="/" className="inline-block">
            <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-2 tracking-tight">
              Drop<span className="text-blue-600">Img</span>
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

        <footer className="mt-auto pt-12 text-gray-400 text-sm">
          <p>© {new Date().getFullYear()} DropImg • Open Source</p>
        </footer>
      </div>
    </BrowserRouter>
  );
}

export default App;
