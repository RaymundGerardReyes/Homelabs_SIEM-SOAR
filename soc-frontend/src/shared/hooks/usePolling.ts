import { useEffect, useRef } from 'react';
import apiClient from '../api/apiClient';

export function usePolling<T>(url: string, intervalMs: number, onData: (data: T) => void, onError?: (err: any) => void) {
  const abortRef = useRef<AbortController | null>(null);
  const onDataRef = useRef(onData);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    onDataRef.current = onData;
    onErrorRef.current = onError;
  }, [onData, onError]);

  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout>;
    
    const poll = async () => {
      abortRef.current = new AbortController();
      try {
        const res = await apiClient.get<T>(url, { signal: abortRef.current.signal });
        onDataRef.current(res.data);
      } catch (err: any) {
        if (err.name === 'CanceledError') return;
        if (onErrorRef.current) onErrorRef.current(err);
        console.error('Polling error', err);
      }
      timeoutId = setTimeout(poll, intervalMs);
    };

    poll();

    return () => {
      abortRef.current?.abort();
      clearTimeout(timeoutId);
    };
  }, [url, intervalMs]);
}
