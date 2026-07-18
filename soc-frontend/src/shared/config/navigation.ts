// =============================================================================
// src/shared/config/navigation.ts
// Sidebar navigation tree — moved out of Sidebar.tsx so nav structure
// can be updated without touching the UI component.
// =============================================================================

import { ROUTES } from './routes';

export interface NavSubItem {
  label: string;
  path: string;
}

export interface NavGroup {
  label: string;
  items: NavSubItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Dashboards & Reports',
    items: [
      { label: 'Overview',          path: ROUTES.dashboard.overview   },
      { label: 'Executive Summary', path: ROUTES.dashboard.executive  },
      { label: 'Compliance',        path: ROUTES.dashboard.compliance },
    ],
  },
  {
    label: 'Incident Response',
    items: [
      { label: 'Active Incidents',  path: ROUTES.incidents.active   },
      { label: 'Closed Incidents',  path: ROUTES.incidents.closed   },
      { label: 'War Room',          path: ROUTES.incidents.warRoom  },
    ],
  },
  {
    label: 'Detection & Threat Intel',
    items: [
      { label: 'Alert Rules',       path: ROUTES.detection.rules },
      { label: 'Threat Feeds',      path: ROUTES.detection.feeds },
      { label: 'IOC Search',        path: ROUTES.detection.ioc   },
    ],
  },
  {
    label: 'Assets',
    items: [
      { label: 'Inventory',         path: ROUTES.assets.inventory       },
      { label: 'Vulnerabilities',   path: ROUTES.assets.vulnerabilities },
      { label: 'Network Map',       path: ROUTES.assets.networkMap      },
    ],
  },
  {
    label: 'Endpoints',
    items: [
      { label: 'Host Management',    path: ROUTES.endpoints.hosts     },
      { label: 'EDR Logs',           path: ROUTES.endpoints.edr       },
      { label: 'Isolation Controls', path: ROUTES.endpoints.isolation },
    ],
  },
];
