const EXTENSION_MIME: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/x-m4v',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  '.3gp': 'video/3gpp',
  '.ogv': 'video/ogg',
};

export function mimeFromFileName(fileName: string): string | undefined {
  const lower = fileName.toLowerCase();
  const dot = lower.lastIndexOf('.');
  if (dot === -1) return undefined;
  return EXTENSION_MIME[lower.slice(dot)];
}

export function resolveVideoMimeType(fileName: string, declaredMime?: string): string {
  const fromExt = mimeFromFileName(fileName);
  const declared = declaredMime?.split(';')[0]?.trim().toLowerCase() ?? '';

  if (fromExt && (!declared || declared === 'application/octet-stream')) {
    return fromExt;
  }

  if (declared.startsWith('video/')) {
    return canonicalVideoMime(declared);
  }

  if (fromExt) {
    return fromExt;
  }

  return declared || 'application/octet-stream';
}

export function isVideoMime(mimeType: string): boolean {
  return canonicalVideoMime(mimeType).startsWith('video/');
}

function canonicalVideoMime(mime: string): string {
  switch (mime.toLowerCase()) {
    case 'video/3gp':
      return 'video/3gpp';
    case 'video/m4v':
      return 'video/x-m4v';
    case 'video/avi':
      return 'video/x-msvideo';
    default:
      return mime.toLowerCase();
  }
}
