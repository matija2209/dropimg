import React, { useEffect, useRef, useState } from 'react';
import { Check, Copy, Film, Image as ImageIcon, SlidersHorizontal, Trash2, Type, Upload } from 'lucide-react';
import { isVideoFile } from '../lib/file-mime';
import {
  type ChunkUploadTelemetry,
  uploadVideoChunked,
} from '../lib/uploads/chunked-uploader';
import { Link } from 'react-router-dom';
import { useSession } from '../lib/auth-client';
import {
  formatDimensions,
  formatMimeLabel,
  formatSize,
  getBase64ApiPath,
  getDisplayName,
  getPreviewUrl,
  type ImageAsset,
  type ProcessingSummary,
  type UploadMode,
} from '../lib/images';

interface UploadResponse extends ImageAsset {
  pageUrl: string;
  deleteUrl: string;
  processing: ProcessingSummary;
}

type ModeConfig = {
  label: string;
  title: string;
  description: string;
  helper: string;
  accept: string;
  acceptedMimeTypes: string[];
  quality?: {
    label: string;
    min: number;
    max: number;
  };
};

const MODE_CONFIG: Record<UploadMode, ModeConfig> = {
  upload: {
    label: 'Upload',
    title: 'Drop image here',
    description: 'Keep the original file format and host it as-is.',
    helper: 'Supports PNG, JPG, WEBP, and GIF uploads.',
    accept: 'image/png,image/jpeg,image/webp,image/gif',
    acceptedMimeTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
  },
  'compress-jpg': {
    label: 'Compress JPG',
    title: 'Drop JPG here',
    description: 'Re-encode uploaded JPGs into a smaller hosted JPG.',
    helper: 'JPG only. If recompression is larger, the original JPG is kept.',
    accept: 'image/jpeg',
    acceptedMimeTypes: ['image/jpeg'],
    quality: {
      label: 'JPG quality',
      min: 60,
      max: 92,
    },
  },
  'png-to-jpg': {
    label: 'PNG to JPG',
    title: 'Drop PNG here',
    description: 'Convert uploaded PNG files into JPG with a white background.',
    helper: 'PNG only. Transparency is flattened onto white.',
    accept: 'image/png',
    acceptedMimeTypes: ['image/png'],
    quality: {
      label: 'JPG quality',
      min: 70,
      max: 95,
    },
  },
  'strip-metadata': {
    label: 'Privacy Strip',
    title: 'Drop image to strip',
    description: 'Remove C2PA data, EXIF, and all other metadata for privacy.',
    helper: 'Supports PNG, JPG, and WEBP. Recommended for privacy-sensitive uploads.',
    accept: 'image/png,image/jpeg,image/webp',
    acceptedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
  },
  'remove-background': {
    label: 'Remove Background',
    title: 'Drop product image here',
    description: 'Proxy the upload through Photoroom and host the cutout result.',
    helper: 'PNG, JPG, and WEBP only. Requires PHOTOROOM_API_KEY on the backend.',
    accept: 'image/png,image/jpeg,image/webp',
    acceptedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
  },
  video: {
    label: 'Video',
    title: 'Drop video here',
    description: 'Upload any video format via resumable chunked transfer.',
    helper: 'MP4, MOV, WEBM, MKV, and more. Large files use 8 MB chunks.',
    accept: 'video/*',
    acceptedMimeTypes: [],
  },
};

type UploadSettings = {
  videoUploadsEnabled: boolean;
  videoTranscodeEnabled: boolean;
  maxVideoUploadMb: number;
  chunkedApiBase: string;
};

import { NoSession } from './NoSession';

export const Uploader: React.FC = () => {
  const { data: session, isPending: isSessionLoading } = useSession();
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [result, setResult] = useState<UploadResponse | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [copying, setCopying] = useState<string | null>(null);
  const [altName, setAltName] = useState('');
  const [mode, setMode] = useState<UploadMode>('upload');
  const [compressQuality, setCompressQuality] = useState(82);
  const [pngToJpgQuality, setPngToJpgQuality] = useState(90);
  const [error, setError] = useState<string | null>(null);
  const [uploadSettings, setUploadSettings] = useState<UploadSettings | null>(null);
  const [videoTranscode, setVideoTranscode] = useState(false);
  const [chunkProgress, setChunkProgress] = useState<ChunkUploadTelemetry | null>(null);
  const [uploadPhase, setUploadPhase] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void fetch('/api/upload/settings', { credentials: 'include' })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (data) {
          setUploadSettings(data as UploadSettings);
        }
      })
      .catch(() => undefined);
  }, []);

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
        icon={Upload}
        title="Login Required"
        description="Please sign in to your account to upload and manage your private image gallery."
        buttonText="Sign In to DropImg"
      />
    );
  }

  const activeMode = MODE_CONFIG[mode];
  const currentQuality =
    mode === 'compress-jpg' ? compressQuality : mode === 'png-to-jpg' ? pngToJpgQuality : undefined;

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
    if (!droppedFile) return;
    if (isVideoFile(droppedFile)) {
      setMode('video');
      uploadFile(droppedFile, 'video');
      return;
    }
    if (droppedFile.type.startsWith('image/')) {
      uploadFile(droppedFile);
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.includes('image')) {
        const pastedFile = items[i].getAsFile();
        if (pastedFile) {
          uploadFile(pastedFile);
        }
      }
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      uploadFile(selectedFile);
    }
    e.target.value = '';
  };

  const uploadFile = async (fileToUpload: File, forcedMode?: UploadMode) => {
    const activeUploadMode = forcedMode ?? mode;

    if (activeUploadMode === 'video' || isVideoFile(fileToUpload)) {
      await uploadVideoFile(fileToUpload);
      return;
    }

    const validationError = validateFileForMode(fileToUpload, activeUploadMode);

    if (validationError) {
      setError(validationError);
      return;
    }

    setError(null);
    setIsUploading(true);
    const formData = new FormData();
    formData.append('file', fileToUpload);
    formData.append('altName', altName);
    formData.append('mode', activeUploadMode);

    if (currentQuality !== undefined) {
      formData.append('quality', String(currentQuality));
    }

    try {
      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
        credentials: 'include',
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error || 'Upload failed');
      }

      const data = (await response.json()) as UploadResponse;
      setResult(data);
    } catch (uploadError) {
      console.error('Error uploading file:', uploadError);
      setError(uploadError instanceof Error ? uploadError.message : 'Upload failed. Please try again.');
    } finally {
      setIsUploading(false);
    }
  };

  const uploadVideoFile = async (fileToUpload: File) => {
    if (!uploadSettings?.videoUploadsEnabled) {
      setError('Video uploads are disabled on this server.');
      return;
    }

    if (!isVideoFile(fileToUpload)) {
      setError('Only video files are supported in video mode.');
      return;
    }

    const maxBytes = uploadSettings.maxVideoUploadMb * 1024 * 1024;
    if (fileToUpload.size > maxBytes) {
      setError(`File exceeds the ${uploadSettings.maxVideoUploadMb} MB video limit.`);
      return;
    }

    setError(null);
    setIsUploading(true);
    setChunkProgress(null);
    setUploadPhase('Uploading chunks…');
    abortRef.current = new AbortController();

    try {
      const data = (await uploadVideoChunked(
        fileToUpload,
        uploadSettings.chunkedApiBase,
        {
          altName: altName || undefined,
          transcode: videoTranscode && uploadSettings.videoTranscodeEnabled,
        },
        {
          onProgress: (telemetry) => setChunkProgress(telemetry),
          onFinalizing: () => setUploadPhase('Processing video…'),
        },
        abortRef.current.signal,
      )) as unknown as UploadResponse;

      setResult(data);
    } catch (uploadError) {
      console.error('Error uploading video:', uploadError);
      setError(uploadError instanceof Error ? uploadError.message : 'Video upload failed.');
    } finally {
      setIsUploading(false);
      setChunkProgress(null);
      setUploadPhase(null);
      abortRef.current = null;
    }
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  };

  const copyBase64ToClipboard = async (variant: 'original' | 'thumbnail') => {
    if (!result) {
      return;
    }

    const copyId = `base64-${variant}`;
    setCopying(copyId);

    try {
      const response = await fetch(getBase64ApiPath(result.id, variant));
      if (!response.ok) {
        throw new Error('Failed to fetch base64');
      }

      const payload = (await response.json()) as { dataUrl: string };
      copyToClipboard(payload.dataUrl, copyId);
    } catch (copyError) {
      console.error('Error copying base64:', copyError);
      setError('Failed to prepare base64. Please try again.');
    } finally {
      setCopying(null);
    }
  };

  const copyOptions = [
    { id: 'direct', label: 'Direct URL', value: result?.directUrl || '' },
    { id: 'auto', label: 'Smart URL (Auto-Responsive)', value: result?.autoUrl || '' },
    { id: 'thumbnail', label: 'Thumbnail URL', value: result?.variants.thumbnail?.url || '' },
    { id: 'tablet', label: 'Tablet URL', value: result?.variants.tablet?.url || '' },
    { id: 'social', label: 'Social URL', value: result?.variants.social?.url || '' },
  ].filter((option) => option.value);

  if (result) {
    const base64Variant = result.variants.thumbnail ? 'thumbnail' : 'original';

    return (
      <div className="w-full max-w-6xl rounded-2xl border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-800">
        <div className="grid gap-0 lg:grid-cols-12">
          <div className="border-b border-gray-200 p-6 dark:border-gray-700 lg:col-span-5 lg:border-b-0 lg:border-r">
            <div className="space-y-4">
              <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900 dark:border-blue-900/60 dark:bg-blue-950/40 dark:text-blue-100">
                <div className="font-medium">{getProcessingHeadline(result.processing)}</div>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-blue-800 dark:text-blue-200">
                  <span>
                    Source: {formatMimeLabel(result.processing.sourceMimeType)} {formatSize(result.processing.sourceSize)}
                  </span>
                  <span>
                    Hosted: {formatMimeLabel(result.processing.outputMimeType)} {formatSize(result.processing.outputSize)}
                  </span>
                  {getProcessingNote(result.processing) && <span>{getProcessingNote(result.processing)}</span>}
                </div>
              </div>

              <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600 dark:border-gray-700 dark:bg-gray-900/40 dark:text-gray-300">
                <div className="font-medium text-gray-900 dark:text-gray-100">{getDisplayName(result)}</div>
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
                  <span>{formatSize(result.original.size)}</span>
                  <span>{formatMimeLabel(result.original.mimeType)}</span>
                  {formatDimensions(result.original.width, result.original.height) && (
                    <span>{formatDimensions(result.original.width, result.original.height)}</span>
                  )}
                  {result.isAnimated && <span>Animated</span>}
                </div>
              </div>

              {copyOptions.map((option) => (
                <div key={option.id}>
                  <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{option.label}</label>
                  <div className="flex gap-2">
                    <input
                      readOnly
                      value={option.value}
                      className="flex-1 rounded border border-gray-200 bg-gray-50 p-2 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                    />
                    <button
                      onClick={() => copyToClipboard(option.value, option.id)}
                      className="rounded bg-blue-600 p-2 text-white transition hover:bg-blue-700"
                    >
                      {copied === option.id ? <Check size={18} /> : <Copy size={18} />}
                    </button>
                  </div>
                </div>
              ))}

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Markdown</label>
                <div className="flex gap-2">
                  <input
                    readOnly
                    value={`![${getDisplayName(result)}](${result.directUrl})`}
                    className="flex-1 rounded border border-gray-200 bg-gray-50 p-2 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                  />
                  <button
                    onClick={() => copyToClipboard(`![${getDisplayName(result)}](${result.directUrl})`, 'md')}
                    className="rounded bg-blue-600 p-2 text-white transition hover:bg-blue-700"
                  >
                    {copied === 'md' ? <Check size={18} /> : <Copy size={18} />}
                  </button>
                </div>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center justify-between">
                  Responsive HTML
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 uppercase">Modern HTML5</span>
                </label>
                <div className="flex gap-2">
                  <textarea
                    readOnly
                    rows={3}
                    value={result.responsiveHtml}
                    className="flex-1 rounded border border-gray-200 bg-gray-50 p-2 text-xs font-mono text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-white resize-none"
                  />
                  <button
                    onClick={() => copyToClipboard(result.responsiveHtml, 'responsive')}
                    className="rounded bg-blue-600 p-2 text-white transition hover:bg-blue-700 self-start"
                  >
                    {copied === 'responsive' ? <Check size={18} /> : <Copy size={18} />}
                  </button>
                </div>
              </div>

              {result.mediaType !== 'video' && !result.mimeType.startsWith('video/') && (
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Base64</label>
                <div className="flex gap-2">
                  <button
                    onClick={() => copyBase64ToClipboard(base64Variant)}
                    className="flex-1 rounded border border-gray-200 bg-gray-50 p-2 text-left text-sm transition hover:border-blue-300 dark:border-gray-700 dark:bg-gray-900 dark:hover:border-blue-700"
                    disabled={copying !== null}
                  >
                    {copying === `base64-${base64Variant}`
                      ? 'Preparing base64 data URL...'
                      : `Copy ${base64Variant} as base64 data URL`}
                  </button>
                  <button
                    onClick={() => copyBase64ToClipboard(base64Variant)}
                    className="rounded bg-blue-600 p-2 text-white transition hover:bg-blue-700 disabled:opacity-50"
                    disabled={copying !== null}
                  >
                    {copied === `base64-${base64Variant}` ? <Check size={18} /> : <Copy size={18} />}
                  </button>
                </div>
              </div>
              )}

              <div className="flex flex-col gap-3 border-t border-gray-200 pt-4 dark:border-gray-700 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex gap-4 items-center">
                  <button
                    onClick={() => {
                      setResult(null);
                      setAltName('');
                      setError(null);
                    }}
                    className="text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                  >
                    Upload another
                  </button>
                  <Link to="/assets" className="text-sm font-medium text-blue-600 hover:text-blue-700">
                    View all assets
                  </Link>
                </div>
                <a
                  href={result.deleteUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-sm text-red-500 hover:text-red-700"
                >
                  <Trash2 size={16} /> Delete asset
                </a>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-center bg-gray-50 p-6 dark:bg-gray-900/50 lg:col-span-7 lg:min-h-[42rem]">
            <div className="flex h-full w-full items-center justify-center overflow-hidden rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-950/80">
              {result.mediaType === 'video' || result.mimeType.startsWith('video/') ? (
                <video
                  src={result.directUrl}
                  poster={result.variants.poster?.url}
                  controls
                  className="max-h-[70vh] w-full"
                />
              ) : (
                <img
                  src={getPreviewUrl(result)}
                  alt={getDisplayName(result)}
                  className="max-h-[70vh] w-full object-contain"
                />
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-6xl flex flex-col gap-4">
      <div className="bg-white dark:bg-gray-800 p-4 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
        <div className="flex flex-wrap gap-2">
          {(Object.keys(MODE_CONFIG) as UploadMode[])
            .filter((entryMode) => entryMode !== 'video' || uploadSettings?.videoUploadsEnabled !== false)
            .map((entryMode) => (
            <button
              key={entryMode}
              type="button"
              onClick={() => {
                setMode(entryMode);
                setError(null);
              }}
              className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                mode === entryMode
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'
              }`}
            >
              {MODE_CONFIG[entryMode].label}
            </button>
          ))}
        </div>
        <div className="mt-3 text-sm text-gray-600 dark:text-gray-300">
          <div className="font-medium text-gray-900 dark:text-white">{activeMode.label}</div>
          <div className="mt-1">{activeMode.description}</div>
          <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">{activeMode.helper}</div>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 p-4 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3 md:flex-1">
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

          {mode === 'video' && uploadSettings?.videoTranscodeEnabled && (
            <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200 md:min-w-72">
              <input
                type="checkbox"
                checked={videoTranscode}
                onChange={(e) => setVideoTranscode(e.target.checked)}
                className="rounded border-gray-300"
              />
              Optimize for web (H.264 MP4)
            </label>
          )}

          {activeMode.quality && currentQuality !== undefined && (
            <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 dark:border-gray-700 dark:bg-gray-900/60 md:min-w-72">
              <div className="flex items-center justify-between gap-4 text-sm">
                <div className="flex items-center gap-2 text-gray-700 dark:text-gray-200">
                  <SlidersHorizontal size={16} />
                  <span>{activeMode.quality.label}</span>
                </div>
                <span className="font-semibold text-gray-900 dark:text-white">{currentQuality}</span>
              </div>
              <input
                type="range"
                min={activeMode.quality.min}
                max={activeMode.quality.max}
                value={currentQuality}
                onChange={(e) => {
                  const nextValue = Number.parseInt(e.target.value, 10);

                  if (mode === 'compress-jpg') {
                    setCompressQuality(nextValue);
                  } else if (mode === 'png-to-jpg') {
                    setPngToJpgQuality(nextValue);
                  }
                }}
                className="mt-3 w-full accent-blue-600"
              />
              <div className="mt-1 flex justify-between text-xs text-gray-500 dark:text-gray-400">
                <span>{activeMode.quality.min}</span>
                <span>{activeMode.quality.max}</span>
              </div>
            </div>
          )}
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
        onClick={() => fileInputRef.current?.click()}
      >
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          accept={activeMode.accept}
          onChange={handleFileChange}
        />

        <div className="mb-4 p-4 bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 rounded-full">
          {isUploading ? (
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-current"></div>
          ) : mode === 'video' ? (
            <Film size={32} />
          ) : (
            <Upload size={32} />
          )}
        </div>

        <h2 className="text-xl font-semibold mb-2 text-gray-800 dark:text-gray-100">
          {isUploading ? uploadPhase || 'Uploading...' : activeMode.title}
        </h2>
        {isUploading && chunkProgress && (
          <div className="mb-4 w-full max-w-md">
            <div className="h-2 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
              <div
                className="h-full bg-blue-600 transition-all"
                style={{ width: `${chunkProgress.progressPercent}%` }}
              />
            </div>
            <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
              {formatSize(chunkProgress.uploadedBytes)} / {formatSize(chunkProgress.fileSize)}
              {chunkProgress.etaSeconds !== null ? ` · ~${chunkProgress.etaSeconds}s remaining` : ''}
            </p>
          </div>
        )}
        <p className="text-gray-500 dark:text-gray-400">{activeMode.description}</p>
        <p className="mt-2 text-xs text-gray-400 dark:text-gray-500">
          Click to browse or paste from clipboard. {activeMode.helper}
        </p>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200">
          {error}
        </div>
      )}

      {!isUploading && (
        <div className="text-xs text-gray-500 dark:text-gray-400">
          Output is hosted as the primary asset, so copied links and gallery previews use the compressed or converted file.
        </div>
      )}

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

function validateFileForMode(file: File, mode: UploadMode): string | null {
  if (mode === 'video') {
    return isVideoFile(file) ? null : 'Video mode only accepts video files.';
  }

  if (!file.type.startsWith('image/')) {
    return 'Only image uploads are supported in this mode.';
  }

  const config = MODE_CONFIG[mode];

  if (config.acceptedMimeTypes.includes(file.type)) {
    return null;
  }

  if (mode === 'compress-jpg') {
    return 'Compress JPG mode only accepts JPG files.';
  }

  if (mode === 'png-to-jpg') {
    return 'PNG to JPG mode only accepts PNG files.';
  }

  if (mode === 'remove-background') {
    return 'Background removal only accepts PNG, JPG, and WEBP files.';
  }

  return 'Upload mode supports PNG, JPG, WEBP, and GIF files.';
}

function getProcessingHeadline(processing: ProcessingSummary): string {
  if (processing.mode === 'video') {
    return processing.transcoded ? 'Video optimized and hosted' : 'Video hosted';
  }

  if (processing.mode === 'strip-metadata') {
    return 'Stripped all metadata (including C2PA)';
  }

  if (processing.mode === 'compress-jpg') {
    return processing.savedBytes > 0
      ? `Compressed JPG by ${processing.savedPercent}%`
      : 'Hosted the original JPG because recompression was not smaller';
  }

  if (processing.mode === 'png-to-jpg') {
    return 'Converted PNG to JPG';
  }

  if (processing.mode === 'remove-background') {
    return 'Removed the background with the configured API';
  }

  return 'Hosted the original upload';
}

function getProcessingNote(processing: ProcessingSummary): string | null {
  if (processing.mode === 'compress-jpg' && processing.savedBytes > 0) {
    return `${formatSize(processing.savedBytes)} saved`;
  }

  if (processing.mode === 'png-to-jpg') {
    return 'Transparency flattened onto white';
  }

  if (processing.mode === 'remove-background') {
    return 'Returned the cutout as the hosted primary asset';
  }

  return null;
}
