import React, { useEffect, useState } from 'react';
import { ExternalLink, Calendar, HardDrive, Copy, Check, Lock } from 'lucide-react';
import { Link } from 'react-router-dom';
import { formatDimensions, formatSize, getDisplayName, getPreviewUrl, type ImageAsset } from '../lib/images';
import { useSession } from '../lib/auth-client';

import { NoSession } from './NoSession';

export const Gallery: React.FC = () => {
  const { data: session, isPending: isSessionLoading } = useSession();
  const [images, setImages] = useState<ImageAsset[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    if (!session) return;
    
    let isCancelled = false;

    void (async () => {
      try {
        const response = await fetch('/api/images');
        if (!response.ok) throw new Error('Failed to fetch images');
        const data = await response.json();

        if (!isCancelled) {
          setImages(data);
        }
      } catch (error) {
        console.error('Error fetching images:', error);
      }
    })();

    return () => {
      isCancelled = true;
    };
  }, [session]);

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  if (isSessionLoading) {
    return (
      <div className="flex justify-center items-center py-20">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (!session) {
    return (
      <NoSession 
        icon={Lock}
        title="Private Gallery"
        description="Sign in to view and manage your uploaded images. Your assets are kept private to your account."
        buttonText="Access Your Gallery"
      />
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
                  src={getPreviewUrl(image)} 
                  alt={getDisplayName(image)} 
                  className="w-full h-full object-cover transition-transform group-hover:scale-105"
                />
                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-3">
                  <Link 
                    to={`/i/${image.id}`}
                    className="p-2 bg-white rounded-full text-gray-900 hover:bg-gray-100 transition"
                    title="View Details"
                  >
                    <ExternalLink size={18} />
                  </Link>
                  <button 
                    onClick={() => copyToClipboard(image.directUrl, `${image.id}-url`)}
                    className="p-2 bg-white rounded-full text-gray-900 hover:bg-gray-100 transition"
                    title="Copy URL"
                  >
                    {copiedId === `${image.id}-url` ? <Check size={18} /> : <Copy size={18} />}
                  </button>
                  <button 
                    onClick={() => copyToClipboard(`![${getDisplayName(image)}](${image.directUrl})`, `${image.id}-md`)}
                    className="p-2 bg-white rounded-full text-gray-900 hover:bg-gray-100 transition font-bold text-xs"
                    title="Copy Markdown"
                  >
                    {copiedId === `${image.id}-md` ? <Check size={18} /> : 'MD'}
                  </button>
                </div>
              </div>
              
              <div className="p-4 flex-1 flex flex-col">
                <Link to={`/i/${image.id}`} className="hover:text-blue-600 transition">
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate mb-1" title={getDisplayName(image)}>
                    {getDisplayName(image)}
                  </p>
                  <p className="text-xs text-gray-400 truncate mb-2">
                    {image.isAnimated ? 'Animated original only' : 'Original + web variants'}
                  </p>
                </Link>
                
                <div className="mt-auto space-y-1">
                  <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                    <Calendar size={14} />
                    {new Date(image.createdAt).toLocaleDateString()}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                    <HardDrive size={14} />
                    {formatSize(image.size)} • {image.mimeType.split('/')[1].toUpperCase()}
                  </div>
                  {formatDimensions(image.width, image.height) && (
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      {formatDimensions(image.width, image.height)}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
