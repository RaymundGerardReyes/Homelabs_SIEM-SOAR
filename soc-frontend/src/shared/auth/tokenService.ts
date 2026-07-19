export const tokenService = {
  // Deprecated: getToken, setToken, clearToken, isTokenExpired are no longer used
  // Authentication state is entirely managed by HttpOnly secure cookies and the /api/auth/session endpoint.
  // We keep the object structure to avoid breaking existing imports until they are fully refactored,
  // but they will safely no-op or return empty.
  getToken: (): string | null => null,
  setToken: (_token: string) => {},
  clearToken: () => {},
  isTokenExpired: (_token: string): boolean => true,
};
