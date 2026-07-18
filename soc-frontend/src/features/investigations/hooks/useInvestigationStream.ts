import { useEffect, useRef, useState } from 'react';

export function useInvestigationStream(investigationId: string | null) {
  const [logs, setLogs] = useState<string[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!investigationId) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host; 
    const wsUrl = `${protocol}//${host}/api/investigations/${investigationId}/stream`;

    console.log(`[WebSocket] Establishing unthrottled pipeline bypass: ${wsUrl}`);
    wsRef.current = new WebSocket(wsUrl);

    wsRef.current.onopen = () => {
      console.log(`[WebSocket] Live Pipeline Connected.`);
      setIsConnected(true);
    };

    wsRef.current.onmessage = (event) => {
      setLogs((prevLogs) => {
        const updated = [...prevLogs, event.data];
        if (updated.length > 1000) {
          return updated.slice(updated.length - 1000);
        }
        return updated;
      });
    };

    wsRef.current.onerror = (error) => {
      console.error(`[WebSocket] Pipeline Transmission Error:`, error);
      setIsConnected(false);
    };

    wsRef.current.onclose = (event) => {
      console.log(`[WebSocket] Pipeline Terminated. Code: ${event.code}`);
      setIsConnected(false);
    };

    return () => {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.close();
      }
    };
  }, [investigationId]);

  return { logs, isConnected };
}
