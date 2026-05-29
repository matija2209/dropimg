export async function postJson<T>(
  url: string,
  body: unknown,
  options?: { signal?: AbortSignal; credentials?: RequestCredentials },
): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: options?.signal,
    credentials: options?.credentials ?? 'same-origin',
  });
  return (await response.json()) as T;
}

export async function putBinaryJson<T>(
  url: string,
  body: Blob,
  options: { offset: number; signal?: AbortSignal; credentials?: RequestCredentials },
): Promise<T> {
  return await new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.responseType = 'json';
    xhr.timeout = 300_000;
    xhr.withCredentials = options.credentials === 'include';
    xhr.setRequestHeader('content-type', 'application/octet-stream');
    xhr.setRequestHeader('x-upload-offset', String(options.offset));

    const abort = () => {
      xhr.abort();
      reject(new DOMException('Upload cancelled', 'AbortError'));
    };

    if (options.signal?.aborted) {
      abort();
      return;
    }

    options.signal?.addEventListener('abort', abort, { once: true });

    xhr.onerror = () => reject(new Error(`Request failed for ${url}`));
    xhr.ontimeout = () => reject(new Error(`Request timed out for ${url}`));
    xhr.onabort = () => reject(new DOMException('Upload cancelled', 'AbortError'));
    xhr.onload = () => {
      options.signal?.removeEventListener('abort', abort);
      const response = xhr.response as T | null;
      if (response !== null) {
        resolve(response);
        return;
      }

      try {
        resolve(JSON.parse(xhr.responseText) as T);
      } catch (error) {
        reject(error);
      }
    };

    xhr.send(body);
  });
}

export async function deleteJson<T>(
  url: string,
  options?: { signal?: AbortSignal; credentials?: RequestCredentials },
): Promise<T> {
  const response = await fetch(url, {
    method: 'DELETE',
    signal: options?.signal,
    credentials: options?.credentials ?? 'same-origin',
  });
  return (await response.json()) as T;
}
