import { Uploader } from './components/Uploader'

function App() {
  return (
    <div className="min-h-screen w-full bg-gray-50 dark:bg-gray-950 flex flex-col items-center py-12 px-4">
      <header className="mb-12 text-center">
        <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-2 tracking-tight">
          Drop<span className="text-blue-600">Img</span>
        </h1>
        <p className="text-gray-600 dark:text-gray-400 max-w-md">
          Simple, fast, and private image hosting. Drag, drop, or paste to upload instantly.
        </p>
      </header>

      <main className="w-full flex justify-center">
        <Uploader />
      </main>

      <footer className="mt-auto pt-12 text-gray-400 text-sm">
        <p>© {new Date().getFullYear()} DropImg • Open Source</p>
      </footer>
    </div>
  )
}

export default App
