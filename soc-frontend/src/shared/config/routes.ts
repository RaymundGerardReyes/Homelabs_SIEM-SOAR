// =============================================================================
// src/shared/config/routes.ts
// Central route path registry — single source of truth for all URL paths.
// =============================================================================

export const ROUTES = {
  root: '/',
  login: '/login',
  dashboard: {
    overview: '/dashboard/overview',
    executive: '/dashboard/executive',
    compliance: '/dashboard/compliance',
  },
  incidents: {
    active: '/incidents/active',
    closed: '/incidents/closed',
    warRoom: '/incidents/war-room',
  },
  detection: {
    rules: '/detection/rules',
    feeds: '/detection/feeds',
    ioc: '/detection/ioc',
  },
  assets: {
    inventory: '/assets/inventory',
    vulnerabilities: '/assets/vulnerabilities',
    networkMap: '/assets/network-map',
  },
  endpoints: {
    hosts: '/endpoints/hosts',
    edr: '/endpoints/edr',
    isolation: '/endpoints/isolation',
  },
  marketplace: '/marketplace',
  settings: '/settings',
  profile: '/profile',
} as const;
