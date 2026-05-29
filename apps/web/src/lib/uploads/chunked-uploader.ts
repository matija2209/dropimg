import { postJson, putBinaryJson } from '../http/upload-request';
import { resolveFileMimeType } from '../file-mime';

export const CHUNK_SIZE_BYTES = 8 * 1024 * 1024;
const DEFAULT_RETRY_DELAYS_MS = [1000, 3000] as const;
const SPEED_SMOOTHING_FACTOR = 0.25;

type ChunkInitResponse =
  | { ok: true; sessionId: string; uploadedBytes: number; fileSize: number }
  | { ok: false; message: string };

type ChunkAppendResponse =
  | { ok: true; sessionId: string; uploadedBytes: number; fileSize: number }
  | { ok: false; message: string; uploadedBytes?: number };

type StoredSession = {
  sessionId: string;
  fileName: string;
  fileSize: number;
  lastModified: number;
};

export type ChunkUploadHandlers = {
  onAttemptStart?: (attempt: number) => void;
  onProgress?: (telemetry: ChunkUploadTelemetry) => void;
  onFinalizing?: () => void;
};

export type ChunkUploadOptions = {
  apiBase: string;
  retryDelaysMs?: readonly number[];
  signal?: AbortSignal;
};

export type ChunkUploadTelemetry = {
  uploadedBytes: number;
  fileSize: number;
  progressPercent: number;
  bytesPerSecond: number | null;
  etaSeconds: number | null;
};

export type ChunkedCompletePayload = {
  altName?: string;
  transcode?: boolean;
};

function storageKey(file: File, apiBase: string): string {
  return `dropimg-chunk:${apiBase}:${file.name}:${file.size}:${file.lastModified}`;
}

function readSession(file: File, apiBase: string): StoredSession | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(storageKey(file, apiBase));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredSession;
    if (
      parsed.fileName !== file.name ||
      parsed.fileSize !== file.size ||
      parsed.lastModified !== file.lastModified
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeSession(file: File, apiBase: string, sessionId: string): void {
  if (typeof window === 'undefined') return;
  window.sessionStorage.setItem(
    storageKey(file, apiBase),
    JSON.stringify({ sessionId, fileName: file.name, fileSize: file.size, lastModified: file.lastModified }),
  );
}

export function clearStoredChunkSession(file: File, apiBase: string): void {
  if (typeof window === 'undefined') return;
  window.sessionStorage.removeItem(storageKey(file, apiBase));
}

function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Upload cancelled', 'AbortError'));
      return;
    }
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(new DOMException('Upload cancelled', 'AbortError'));
      },
      { once: true },
    );
  });
}

function toProgressPercent(uploadedBytes: number, fileSize: number): number {
  if (fileSize <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((uploadedBytes / fileSize) * 100)));
}

function buildTelemetry(
  uploadedBytes: number,
  fileSize: number,
  bytesPerSecond: number | null,
): ChunkUploadTelemetry {
  const remainingBytes = Math.max(fileSize - uploadedBytes, 0);
  return {
    uploadedBytes,
    fileSize,
    progressPercent: toProgressPercent(uploadedBytes, fileSize),
    bytesPerSecond,
    etaSeconds:
      bytesPerSecond && bytesPerSecond > 0 && remainingBytes > 0
        ? Math.ceil(remainingBytes / bytesPerSecond)
        : null,
  };
}

export async function uploadFileChunked(
  file: File,
  options: ChunkUploadOptions,
  handlers: ChunkUploadHandlers = {},
): Promise<string> {
  const { apiBase, retryDelaysMs = DEFAULT_RETRY_DELAYS_MS, signal } = options;
  const { onAttemptStart, onProgress, onFinalizing } = handlers;

  if (signal?.aborted) throw new DOMException('Upload cancelled', 'AbortError');

  let currentSessionId = readSession(file, apiBase)?.sessionId;

  for (let attempt = 0; attempt <= retryDelaysMs.length; attempt++) {
    if (signal?.aborted) throw new DOMException('Upload cancelled', 'AbortError');
    onAttemptStart?.(attempt);

    try {
      const init = await postJson<ChunkInitResponse>(
        `${apiBase}/init`,
        {
          sessionId: currentSessionId,
          fileName: file.name,
          mimeType: resolveFileMimeType(file),
          fileSize: file.size,
        },
        { signal, credentials: 'include' },
      );

      if (!('ok' in init) || !init.ok) {
        throw new Error('message' in init ? init.message : 'Failed to start upload');
      }

      currentSessionId = init.sessionId;
      writeSession(file, apiBase, init.sessionId);

      let uploadedBytes = init.uploadedBytes;
      const resumingFromBytes = init.uploadedBytes;
      let smoothedBytesPerSecond: number | null = null;
      let lastSample = {
        uploadedBytes,
        timeMs: typeof performance !== 'undefined' ? performance.now() : Date.now(),
      };
      onProgress?.(buildTelemetry(uploadedBytes, file.size, smoothedBytesPerSecond));

      while (uploadedBytes < file.size) {
        if (signal?.aborted) throw new DOMException('Upload cancelled', 'AbortError');

        const end = Math.min(uploadedBytes + CHUNK_SIZE_BYTES, file.size);
        const chunk = file.slice(uploadedBytes, end);
        try {
          await chunk.slice(0, 1).arrayBuffer();
        } catch {
          const nothingUploaded = resumingFromBytes === 0 && uploadedBytes === 0;
          throw new DOMException(
            nothingUploaded ? 'not-stored-locally' : 'expired-mid-upload',
            'NotReadableError',
          );
        }

        const response = await putBinaryJson<ChunkAppendResponse>(
          `${apiBase}/${init.sessionId}`,
          chunk,
          { offset: uploadedBytes, signal, credentials: 'include' },
        );

        if (!response.ok) {
          if (typeof response.uploadedBytes === 'number') {
            uploadedBytes = response.uploadedBytes;
            lastSample = {
              uploadedBytes,
              timeMs: typeof performance !== 'undefined' ? performance.now() : Date.now(),
            };
            onProgress?.(buildTelemetry(uploadedBytes, file.size, smoothedBytesPerSecond));
            continue;
          }
          throw new Error(response.message);
        }

        uploadedBytes = response.uploadedBytes;
        const nextSampleTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
        const deltaBytes = uploadedBytes - lastSample.uploadedBytes;
        const deltaTimeMs = Math.max(nextSampleTime - lastSample.timeMs, 1);
        if (deltaBytes > 0) {
          const instantaneousBytesPerSecond = (deltaBytes / deltaTimeMs) * 1000;
          smoothedBytesPerSecond =
            smoothedBytesPerSecond === null
              ? instantaneousBytesPerSecond
              : smoothedBytesPerSecond * (1 - SPEED_SMOOTHING_FACTOR) +
                instantaneousBytesPerSecond * SPEED_SMOOTHING_FACTOR;
        }
        lastSample = { uploadedBytes, timeMs: nextSampleTime };
        onProgress?.(buildTelemetry(uploadedBytes, file.size, smoothedBytesPerSecond));
      }

      onFinalizing?.();
      return init.sessionId;
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') throw err;
      if (err instanceof DOMException && err.name === 'NotReadableError') {
        const notStoredLocally = err.message === 'not-stored-locally';
        throw new Error(
          notStoredLocally
            ? 'Video is not stored locally on this device. Save it to your gallery and try again.'
            : 'Video became unreadable during upload. Re-select the file to resume.',
        );
      }
      if (attempt < retryDelaysMs.length) {
        await abortableSleep(retryDelaysMs[attempt]!, signal);
        continue;
      }
      throw err instanceof Error ? err : new Error('Upload failed. Please try again.');
    }
  }

  throw new Error('Upload failed. Please try again.');
}

export async function completeChunkedVideoUpload(
  apiBase: string,
  sessionId: string,
  payload: ChunkedCompletePayload,
  options?: { signal?: AbortSignal },
): Promise<Record<string, unknown>> {
  const response = await postJson<Record<string, unknown>>(
    `${apiBase}/complete`,
    {
      sessionId,
      altName: payload.altName,
      transcode: payload.transcode,
    },
    { signal: options?.signal, credentials: 'include' },
  );

  if (response && typeof response === 'object' && 'error' in response && response.error) {
    throw new Error(String(response.error));
  }
  if (response && typeof response === 'object' && 'ok' in response && response.ok === false) {
    throw new Error(String((response as { message?: string }).message ?? 'Finalize failed'));
  }

  return response;
}

export async function uploadVideoChunked(
  file: File,
  apiBase: string,
  payload: ChunkedCompletePayload,
  handlers: ChunkUploadHandlers = {},
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const sessionId = await uploadFileChunked(file, { apiBase, signal }, handlers);
  const result = await completeChunkedVideoUpload(apiBase, sessionId, payload, { signal });
  clearStoredChunkSession(file, apiBase);
  return result;
}
