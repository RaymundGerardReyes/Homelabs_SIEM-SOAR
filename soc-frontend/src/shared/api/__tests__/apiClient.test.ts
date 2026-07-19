import apiClient from '../apiClient';
import { tokenService } from '../../auth/tokenService';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../auth/tokenService', () => ({
  tokenService: {
    clearToken: vi.fn(),
  },
}));

describe('apiClient Interceptor Path Tests', () => {
  const originalLocation = window.location;

  beforeEach(() => {
    vi.clearAllMocks();
    delete (window as any).location;
    window.location = { ...originalLocation, pathname: '/', href: '' } as any;
  });

  afterEach(() => {
    (window as any).location = originalLocation;
  });

  it('Path 1: Successfully passes 200 OK responses', async () => {
    const interceptor = (apiClient.interceptors.response as any).handlers[0].fulfilled;
    const response = { status: 200, data: 'ok' };
    expect(interceptor(response)).toBe(response);
  });

  it('Path 2: 401 Unauthorized redirects to login when NOT on login page', async () => {
    const interceptor = (apiClient.interceptors.response as any).handlers[0].rejected;
    window.location.pathname = '/dashboard';

    const error = { response: { status: 401 } };
    
    await expect(interceptor(error)).rejects.toEqual(error);
    expect(tokenService.clearToken).toHaveBeenCalled();
    expect(window.location.href).toContain('/login?redirect=%2Fdashboard');
  });

  it('Path 3: 401 Unauthorized safely ignores redirect when ALREADY on login page', async () => {
    const interceptor = (apiClient.interceptors.response as any).handlers[0].rejected;
    window.location.pathname = '/login';
    window.location.href = 'http://localhost/login'; // Initial state

    const error = { response: { status: 401 } };
    
    await expect(interceptor(error)).rejects.toEqual(error);
    expect(tokenService.clearToken).toHaveBeenCalled();
    // Verify window.location.href did NOT change to a recursive redirect loop
    expect(window.location.href).toBe('http://localhost/login');
  });

  it('Path 4: 403 Forbidden redirects to unauthorized page', async () => {
    const interceptor = (apiClient.interceptors.response as any).handlers[0].rejected;
    const error = { response: { status: 403 } };
    
    await expect(interceptor(error)).rejects.toEqual(error);
    expect(window.location.href).toBe('/unauthorized');
  });
});
