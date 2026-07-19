export const theme = {
  severity: {
    S1: 'text-red-500 bg-red-500/10 border-red-500/30', // Critical
    S2: 'text-orange-500 bg-orange-500/10 border-orange-500/30', // High
    S3: 'text-yellow-500 bg-yellow-500/10 border-yellow-500/30', // Medium
    S4: 'text-blue-500 bg-blue-500/10 border-blue-500/30', // Low
  },
  risk: {
    critical: 'text-red-500',
    high: 'text-orange-500',
    medium: 'text-yellow-500',
    low: 'text-blue-500',
  },
  status: {
    success: 'text-green-400',
    warning: 'text-yellow-400',
    error: 'text-red-400',
    info: 'text-blue-400',
  }
};
