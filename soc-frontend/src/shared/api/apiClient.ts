import axios from 'axios';
import { tokenService } from '../auth/tokenService';

const apiClient = axios.create({
  baseURL: (import.meta as any).env.VITE_API_BASE_URL || '/api',
  withCredentials: true, // Crucial for HttpOnly cookies
});

apiClient.interceptors.request.use((config) => {
  // We no longer manually inject Authorization Bearer tokens.
  // The browser automatically attaches the HttpOnly cookie.
  
  // Generate unified trace ID for cross-service incident correlation
  const correlationId = window.crypto?.randomUUID 
      ? window.crypto.randomUUID() 
      : Math.random().toString(36).substring(2, 15);
  
  config.headers['X-Correlation-ID'] = correlationId;
  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      tokenService.clearToken();
      if (window.location.pathname !== '/login') {
        window.location.href = `/login?redirect=${encodeURIComponent(window.location.pathname)}`;
      }
    } else if (error.response?.status === 403) {
      window.location.href = '/unauthorized';
    }
    return Promise.reject(error);
  }
);

export default apiClient;
