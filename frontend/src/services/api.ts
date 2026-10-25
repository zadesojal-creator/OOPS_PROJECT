import { auth } from './firebase';

const base = import.meta.env.VITE_API_BASE_URL || '/api';

function apiUrl(path: string) {
  const normalizedBase = base.replace(/\/+$/, '');
  if (path === normalizedBase || path.startsWith(`${normalizedBase}/`)) {
    return path;
  }
  if (path.startsWith('/api/') && normalizedBase.endsWith('/api')) {
    return `${normalizedBase}${path.slice(4)}`;
  }
  return `${normalizedBase}${path.startsWith('/') ? path : `/${path}`}`;
}

export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error('Sign in is required to access clinic data.');
  }
  const token = await currentUser.getIdToken();
  const headers = new Headers(options.headers);
  if (options.body instanceof FormData) {
    headers.delete('Content-Type');
  } else {
    headers.set('Content-Type', 'application/json');
  }
  headers.set('Authorization', `Bearer ${token}`);

  const res = await fetch(apiUrl(path), {
    ...options,
    headers,
  });

  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body: unknown = await res.json();
      if (
        typeof body === 'object' &&
        body !== null &&
        'message' in body &&
        typeof body.message === 'string'
      ) {
        message = body.message;
      } else if (
        typeof body === 'object' &&
        body !== null &&
        'detail' in body &&
        typeof body.detail === 'string'
      ) {
        message = body.detail;
      }
    } catch {
      // Keep the HTTP status when the server does not return JSON.
    }
    throw new Error(message);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const get = <T,>(path: string) => api<T>(path);

export const post = <T,>(path: string, body?: unknown) =>
  api<T>(path, {
    method: 'POST',
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

export const put = <T,>(path: string, body?: unknown) =>
  api<T>(path, {
    method: 'PUT',
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

export const patch = <T,>(path: string, body?: unknown) =>
  api<T>(path, {
    method: 'PATCH',
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

export const del = <T,>(path: string) =>
  api<T>(path, {
    method: 'DELETE',
  });

export async function downloadFile(path: string, fileName: string): Promise<void> {
  const currentUser = auth.currentUser;
  if (!currentUser) throw new Error('Sign in is required to download this file.');
  const response = await fetch(apiUrl(path), {
    headers: { Authorization: `Bearer ${await currentUser.getIdToken()}` },
  });
  if (!response.ok) {
    throw new Error(`Unable to download prescription (${response.status}).`);
  }
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export async function getFileBlobUrl(path: string): Promise<string> {
  const currentUser = auth.currentUser;
  if (!currentUser) throw new Error('Sign in is required.');
  const response = await fetch(apiUrl(path), {
    headers: { Authorization: `Bearer ${await currentUser.getIdToken()}` },
  });
  if (!response.ok) {
    throw new Error(`Unable to load file (${response.status}).`);
  }
  const blob = await response.blob();
  return URL.createObjectURL(blob);
}

export function queryPath(path: string, parameters: Record<string, string>) {
  const query = new URLSearchParams(parameters);
  return `${path}?${query.toString()}`;
}
