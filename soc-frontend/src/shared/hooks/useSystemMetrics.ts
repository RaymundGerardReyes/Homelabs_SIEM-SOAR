import { useState, useEffect, useRef } from 'react';
import apiClient from './useAuthApi';
import type { SystemMetrics } from '@/types';

export function useSystemMetrics(refreshIntervalMs = 30000) {
  const [metrics, setMetrics] = useState<SystemMetrics | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchMetrics = async () => {
    try {
      setError(null);
      const res = await apiClient.get<SystemMetrics>('/data/metrics/overview');
      setMetrics(res.data);
    } catch {
      setError('Failed to load system metrics.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMetrics();
    intervalRef.current = setInterval(fetchMetrics, refreshIntervalMs);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [refreshIntervalMs]);

  return { metrics, loading, error, retry: fetchMetrics };
}
