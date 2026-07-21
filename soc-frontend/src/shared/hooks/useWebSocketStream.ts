import { useEffect, useRef, useState } from 'react';

export function useWebSocketStream<T>(url: string, onMessage?: (data: T) => void) {
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const retryCount = useRef(0);

  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout>;

    const connect = () => {
      // Relying on HttpOnly cookies, so we don't manually append a token parameter.
      // And we DEFINITELY don't trigger a window.location page redirect in a reconnect loop!
      const wsUrl = new URL(url, window.location.href);
      wsUrl.protocol = wsUrl.protocol === 'https:' ? 'wss:' : 'ws:';

      const ws = new WebSocket(wsUrl.toString());
      wsRef.current = ws;

      ws.onopen = () => {
        setIsConnected(true);
        retryCount.current = 0;
      };

      ws.onmessage = (event) => {
        if (onMessage) {
          try {
            onMessage(JSON.parse(event.data));
          } catch {
            onMessage(event.data as unknown as T);
          }
        }
      };

      ws.onclose = () => {
        setIsConnected(false);
        const backoff = Math.min(1000 * Math.pow(2, retryCount.current), 30000);
        retryCount.current += 1;
        timeoutId = setTimeout(connect, backoff);
      };
    };

    connect();

    return () => {
      clearTimeout(timeoutId);
      if (wsRef.current) wsRef.current.close();
    };
  }, [url]);

  return { isConnected };
}
