// ==============================================================================
// SHARED AUTHENTICATED API CLIENT
// ==============================================================================
import axios, { AxiosInstance } from 'axios';
import { useCallback } from 'react';

export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const base64Url = token.split('.')[1];
    if (!base64Url) return null;
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(window.atob(base64));
  } catch {
    return null;
  }
}

export function isTokenExpired(token: string): boolean {
  const payload = decodeJwtPayload(token);
  if (!payload || typeof payload.exp !== 'number') return true;
  return Date.now() / 1000 >= payload.exp;
}

export function getTokenRole(token: string): string | null {
  const payload = decodeJwtPayload(token);
  if (!payload) return null;
  return (payload.role as string) ?? null;
}

export function getValidToken(): string | null {
  const token = localStorage.getItem('internal_access_token');
  if (!token) return null;
  if (isTokenExpired(token)) {
    localStorage.removeItem('internal_access_token');
    window.location.href = '/login';
    return null;
  }
  return token;
}

export const apiClient: AxiosInstance = axios.create({
  baseURL: '/api',
});

apiClient.interceptors.request.use((config) => {
  const token = getValidToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export function useAuthApi() {
  const get = useCallback(apiClient.get.bind(apiClient), []);
  const post = useCallback(apiClient.post.bind(apiClient), []);
  return { apiClient, get, post };
}

export default apiClient;
