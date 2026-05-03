import React, { useState, useCallback } from 'react';
import { Upload, Copy, Check, Trash2, Image as ImageIcon, Type } from 'lucide-react';
import { Link } from 'react-router-dom';
import { formatDimensions, formatSize, getDisplayName, getPreviewUrl } from '../lib/images';
import type { ImageAsset } from '../lib/images';

interface UploadResponse extends ImageAsset {
  pageUrl: string;
  deleteUrl: string;
}

export const Uploader: React.FC = () => {
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [result, setResult] = useState<UploadResponse | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [altName, setAltName] = useState('');

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile && droppedFile.type.startsWith('image/')) {
      uploadFile(droppedFile);
    }
  };

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        const pastedFile = items[i].getAsFile();
        if (pastedFile) {
          uploadFile(pastedFile);
        }
      }
    }
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      uploadFile(selectedFile);
    }
  };

  const uploadFile = async (fileToUpload: File) => {
    setIsUploading(true);
    const formData = new FormData();
    formData.append('file', fileToUpload);
    formData.append('altName', altName);

    try {
      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) throw new Error('Upload failed');

      const data = await response.json();
      setResult(data);
    } catch (error) {
      console.error('Error uploading file:', error);
      alert('Upload failed. Please try again.');
    } finally {
      setIsUploading(false);
    }
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  };

  const copyOptions = [
    { id: 'direct', label: 'Original URL', value: result?.directUrl || '' },
    { id: 'tablet', label: 'Tablet URL', value: result?.variants.tablet?.url || '' },
    { id: 'social', label: 'Social URL', value: result?.variants.social?.url || '' },
  ].filter((option) => option.value);

  if (result) {
    return (
      <div className="w-full max-w-2xl p-6 bg-white dark:bg-gray-800 rounded-xl shadow-lg">
        <div className="mb-6 overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700">
          <img src={getPreviewUrl(result)} alt={getDisplayName(result)} className="w-full h-auto max-h-96 object-contain bg-gray-50 dark:bg-gray-900" />
        </div>

        <div className="space-y-4">
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 p-4 text-sm text-gray-600 dark:text-gray-300">
            <div className="font-medium text-gray-900 dark:text-gray-100">{getDisplayName(result)}</div>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
              <span>{formatSize(result.original.size)}</span>
              <span>{result.original.mimeType.split('/')[1].toUpperCase()}</span>
              {formatDimensions(result.original.width, result.original.height) && (
                <span>{formatDimensions(result.original.width, result.original.height)}</span>
              )}
              {result.isAnimated && <span>Animated</span>}
            </div>
          </div>

          {copyOptions.map((option) => (
            <div key={option.id}>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{option.label}</label>
              <div className="flex gap-2">
                <input readOnly value={option.value} className="flex-1 p-2 text-sm bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded" />
                <button onClick={() => copyToClipboard(option.value, option.id)} className="p-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition">
                  {copied === option.id ? <Check size={18} /> : <Copy size={18} />}
                </button>
              </div>
            </div>
          ))}

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Markdown</label>
            <div className="flex gap-2">
              <input readOnly value={`![${getDisplayName(result)}](${result.directUrl})`} className="flex-1 p-2 text-sm bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded" />
              <button onClick={() => copyToClipboard(`![${getDisplayName(result)}](${result.directUrl})`, 'md')} className="p-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition">
                {copied === 'md' ? <Check size={18} /> : <Copy size={18} />}
              </button>
            </div>
          </div>

          <div className="pt-4 border-t border-gray-200 dark:border-gray-700 flex justify-between items-center">
            <div className="flex gap-4 items-center">
              <button onClick={() => { setResult(null); setAltName(''); }} className="text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">
                Upload another
              </button>
              <Link to="/assets" className="text-sm text-blue-600 hover:text-blue-700 font-medium">
                View all assets
              </Link>
            </div>
            <a href={result.deleteUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-sm text-red-500 hover:text-red-700">
              <Trash2 size={16} /> Delete asset
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-2xl flex flex-col gap-4">
      <div className="bg-white dark:bg-gray-800 p-4 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-gray-100 dark:bg-gray-700 rounded-lg text-gray-500 dark:text-gray-400">
            <Type size={20} />
          </div>
          <input 
            type="text" 
            placeholder="Image Alt Name (optional)" 
            value={altName}
            onChange={(e) => setAltName(e.target.value)}
            className="flex-1 bg-transparent border-none focus:ring-0 text-gray-900 dark:text-white placeholder-gray-400"
          />
        </div>
      </div>

      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onPaste={handlePaste}
        className={`w-full p-12 border-2 border-dashed rounded-xl transition-all flex flex-col items-center justify-center text-center cursor-pointer
          ${isDragging ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20' : 'border-gray-300 dark:border-gray-700 hover:border-blue-400'}
          ${isUploading ? 'opacity-50 pointer-events-none' : ''}`}
        onClick={() => document.getElementById('fileInput')?.click()}
      >
        <input type="file" id="fileInput" className="hidden" accept="image/*" onChange={handleFileChange} />
        
        <div className="mb-4 p-4 bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 rounded-full">
          {isUploading ? (
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-current"></div>
          ) : (
            <Upload size={32} />
          )}
        </div>

        <h2 className="text-xl font-semibold mb-2 text-gray-800 dark:text-gray-100">
          {isUploading ? 'Uploading...' : 'Drop image here'}
        </h2>
        <p className="text-gray-500 dark:text-gray-400">
          or click to browse. Paste from clipboard works too!
        </p>
      </div>

      {!isUploading && (
        <Link 
          to="/assets" 
          className="flex items-center justify-center gap-2 p-4 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-gray-600 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 hover:border-blue-200 dark:hover:border-blue-900/40 transition shadow-sm group"
        >
          <ImageIcon size={20} className="group-hover:scale-110 transition-transform" />
          <span className="font-medium">Browse your uploaded assets</span>
        </Link>
      )}
    </div>
  );
};
