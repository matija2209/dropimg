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

export function resolveFileMimeType(file: File): string {
  const name = file.name.toLowerCase();
  const dot = name.lastIndexOf('.');
  const fromExt = dot >= 0 ? EXTENSION_MIME[name.slice(dot)] : undefined;
  const declared = file.type?.split(';')[0]?.trim().toLowerCase() ?? '';

  if (fromExt && (!declared || declared === 'application/octet-stream')) {
    return fromExt;
  }

  if (declared.startsWith('video/')) {
    return declared;
  }

  return fromExt || declared || 'application/octet-stream';
}

export function isVideoFile(file: File): boolean {
  return resolveFileMimeType(file).startsWith('video/');
}
