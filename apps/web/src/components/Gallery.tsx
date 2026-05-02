import React, { useEffect, useState } from 'react';
import { ExternalLink, Calendar, HardDrive } from 'lucide-react';
import { Link } from 'react-router-dom';

interface ImageAsset {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  createdAt: string;
  directUrl: string;
}

export const Gallery: React.FC = () => {
  const [images, setImages] = useState<ImageAsset[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchImages = async () => {
    try {
      const response = await fetch('/api/images');
      if (!response.ok) throw new Error('Failed to fetch images');
      const data = await response.json();
      setImages(data);
    } catch (error) {
      console.error('Error fetching images:', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchImages();
  }, []);

  const formatSize = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  if (isLoading) {
    return (
      <div className="flex justify-center items-center py-20">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-6xl">
      <div className="flex justify-between items-center mb-8">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Uploaded Assets</h2>
        <Link to="/" className="text-blue-600 hover:text-blue-700 font-medium">
          + Upload New
        </Link>
      </div>

      {images.length === 0 ? (
        <div className="text-center py-20 bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700">
          <p className="text-gray-500 dark:text-gray-400">No images uploaded yet.</p>
          <Link to="/" className="mt-4 inline-block text-blue-600 hover:underline">
            Go to Uploader
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {images.map((image) => (
            <div key={image.id} className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden flex flex-col group">
              <div className="aspect-video bg-gray-50 dark:bg-gray-900 relative overflow-hidden">
                <img 
                  src={image.directUrl} 
                  alt={image.filename} 
                  className="w-full h-full object-cover transition-transform group-hover:scale-105"
                />
                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-4">
                  <a 
                    href={image.directUrl} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="p-2 bg-white rounded-full text-gray-900 hover:bg-gray-100 transition"
                    title="View Original"
                  >
                    <ExternalLink size={20} />
                  </a>
                </div>
              </div>
              
              <div className="p-4 flex-1 flex flex-col">
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate mb-2" title={image.filename}>
                  {image.filename}
                </p>
                
                <div className="mt-auto space-y-1">
                  <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                    <Calendar size={14} />
                    {new Date(image.createdAt).toLocaleDateString()}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                    <HardDrive size={14} />
                    {formatSize(image.size)} • {image.mimeType.split('/')[1].toUpperCase()}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
