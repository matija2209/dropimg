import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Copy, Check, ExternalLink, Calendar, HardDrive, ArrowLeft } from 'lucide-react';
import { formatDimensions, formatSize, getBase64ApiPath, getDisplayName, getPrimaryViewUrl, type ImageAsset } from '../lib/images';

type RenditionEntry = {
  key: string;
  label: string;
  rendition: ImageAsset['original'];
};

export const ImagePreview: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const [image, setImage] = useState<ImageAsset | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [copied, setCopied] = useState<string | null>(null);
  const [copying, setCopying] = useState<string | null>(null);

  useEffect(() => {
    const fetchImage = async () => {
      try {
        const response = await fetch(`/api/images/${id}`);
        if (!response.ok) throw new Error('Image not found');
        const data = await response.json();
        setImage(data);
      } catch (error) {
        console.error('Error fetching image:', error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchImage();
  }, [id]);

  const copyToClipboard = (text: string, type: string) => {
    navigator.clipboard.writeText(text);
    setCopied(type);
    setTimeout(() => setCopied(null), 2000);
  };

  const copyBase64ToClipboard = async (variant: RenditionEntry['key']) => {
    if (!image) {
      return;
    }

    const copyId = `${variant}-base64`;
    setCopying(copyId);

    try {
      const response = await fetch(getBase64ApiPath(image.id, variant as 'original' | 'thumbnail' | 'card' | 'tablet' | 'social'));
      if (!response.ok) {
        throw new Error('Failed to fetch base64');
      }

      const payload = await response.json();
      copyToClipboard(payload.dataUrl, copyId);
    } catch (error) {
      console.error('Error copying base64:', error);
      alert('Failed to prepare base64. Please try again.');
    } finally {
      setCopying(null);
    }
  };

  const renditionEntries: RenditionEntry[] = image
    ? [
        { key: 'original', label: 'Original', rendition: image.original },
        { key: 'thumbnail', label: 'Thumbnail', rendition: image.variants.thumbnail },
        { key: 'card', label: 'Card', rendition: image.variants.card },
        { key: 'tablet', label: 'Tablet', rendition: image.variants.tablet },
        { key: 'social', label: 'Social', rendition: image.variants.social },
      ].reduce<RenditionEntry[]>((entries, entry) => {
        if (entry.rendition) {
          entries.push({
            key: entry.key,
            label: entry.label,
            rendition: entry.rendition,
          });
        }

        return entries;
      }, [])
    : [];

  if (isLoading) {
    return (
      <div className="flex justify-center items-center py-20">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (!image) {
    return (
      <div className="text-center py-20">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">Image not found</h2>
        <Link to="/assets" className="text-blue-600 hover:underline flex items-center justify-center gap-2">
          <ArrowLeft size={16} /> Back to Gallery
        </Link>
      </div>
    );
  }

  return (
    <div className="w-full max-w-6xl">
      <Link to="/assets" className="inline-flex items-center gap-2 text-gray-600 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition mb-6">
        <ArrowLeft size={18} />
        Back to Gallery
      </Link>

      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="grid gap-0 lg:grid-cols-12">
          <div className="p-6 border-b border-gray-200 dark:border-gray-700 lg:col-span-5 lg:border-b-0 lg:border-r">
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-4">
                <div>
                  <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2 truncate max-w-md">
                    {getDisplayName(image)}
                  </h2>
                  <div className="flex flex-wrap gap-4 text-sm text-gray-500 dark:text-gray-400">
                    <span className="flex items-center gap-1.5"><Calendar size={14} /> {new Date(image.createdAt).toLocaleDateString()}</span>
                    <span className="flex items-center gap-1.5"><HardDrive size={14} /> {formatSize(image.size)}</span>
                    <span className="uppercase">{image.mimeType.split('/')[1]}</span>
                    {formatDimensions(image.width, image.height) && <span>{formatDimensions(image.width, image.height)}</span>}
                    {image.isAnimated && <span>Animated</span>}
                  </div>
                </div>
                <a
                  href={image.directUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex w-fit items-center gap-2 rounded-lg bg-gray-100 px-4 py-2 font-medium text-gray-700 transition hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
                >
                  <ExternalLink size={18} />
                  Open Original
                </a>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Direct URL</label>
                <div className="flex gap-2">
                  <input
                    readOnly
                    value={image.directUrl}
                    className="flex-1 p-3 text-sm text-gray-900 dark:text-white bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 transition"
                  />
                  <button
                    onClick={() => copyToClipboard(image.directUrl, 'direct')}
                    className="p-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition shadow-sm active:scale-95"
                  >
                    {copied === 'direct' ? <Check size={20} /> : <Copy size={20} />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Markdown Code</label>
                <div className="flex gap-2">
                  <input
                    readOnly
                    value={`![${getDisplayName(image)}](${image.directUrl})`}
                    className="flex-1 p-3 text-sm text-gray-900 dark:text-white bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 transition"
                  />
                  <button
                    onClick={() => copyToClipboard(`![${getDisplayName(image)}](${image.directUrl})`, 'md')}
                    className="p-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition shadow-sm active:scale-95"
                  >
                    {copied === 'md' ? <Check size={20} /> : <Copy size={20} />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Available Renditions</label>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
                  {renditionEntries.map((entry) => (
                    <div key={entry.key} className="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/60 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="font-medium text-gray-900 dark:text-white">{entry.label}</div>
                          <div className="text-xs text-gray-500 dark:text-gray-400">
                            {[formatDimensions(entry.rendition.width, entry.rendition.height), formatSize(entry.rendition.size), entry.rendition.mimeType.split('/')[1].toUpperCase()].filter(Boolean).join(' • ')}
                          </div>
                        </div>
                        <button
                          onClick={() => copyToClipboard(entry.rendition.url, entry.key)}
                          className="p-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
                        >
                          {copied === entry.key ? <Check size={18} /> : <Copy size={18} />}
                        </button>
                      </div>
                      <div className="mt-3 flex items-center gap-3">
                        <a
                          href={entry.rendition.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-2 text-sm text-blue-600 hover:text-blue-700"
                        >
                          <ExternalLink size={16} />
                          Open rendition
                        </a>
                        <button
                          onClick={() => copyBase64ToClipboard(entry.key)}
                          className="inline-flex items-center gap-2 text-sm text-blue-600 hover:text-blue-700 disabled:opacity-50"
                          disabled={copying !== null}
                        >
                          {copied === `${entry.key}-base64` ? <Check size={16} /> : <Copy size={16} />}
                          {copying === `${entry.key}-base64` ? 'Preparing base64...' : 'Copy base64'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="bg-gray-50 dark:bg-gray-900/50 p-6 flex items-center justify-center lg:col-span-7 lg:min-h-[42rem]">
            <div className="flex h-full w-full items-center justify-center overflow-hidden rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-950/80">
              <img
                src={getPrimaryViewUrl(image)}
                alt={getDisplayName(image)}
                className="max-h-[70vh] w-full object-contain rounded"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
