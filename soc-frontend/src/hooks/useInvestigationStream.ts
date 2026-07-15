import { useEffect, useRef, useState } from 'react';

// Custom React Hook to manage high-throughput SIEM streaming
// ==============================================================================
// 1. 🌐 COMPONENT PLACEMENT & GLOBAL WORKFLOW TRACE
//    - High-Speed Network Tunnel: Custom React hook managing the SSE/WS layer.
//    - Upstream: React Components | Downstream: Nginx WebSocket Proxy (`/api/investigations/*/stream`)
// 2. 🛡️ LOGICAL INTENT & SYSTEM RESPONSIBILITY
//    - Maintains a persistent full-duplex transmission channel bypassing standard
//      REST limitations to pipe massive SIEM raw logs directly into React state.
// 3. 🚨 INFRASTRUCTURE GUARDRAILS & RESOURCE CONSTRAINTS
//    - Memory Leaks: React `useEffect` teardowns MUST close the `WebSocket` on unmount.
//      Failure to call `wsRef.current.close()` creates "zombie" open sockets
//      that will exhaust Nginx worker pool connections.
//    - Ring Buffer: Enforces a strict 1000-item maximum slice to prevent JavaScript
//      Heap OOM crashes on the client browser.
// 4. 🔗 CROSS-MODULE INTERFACE & CONTRACT BOUNDARIES
//    - Wraps the native browser `WebSocket` API and exposes `[logs, isConnected]`.
// 5. ☣️ FAILURE DOMAINS & RESILIENCE STATE
//    - Failure Mode: Nginx drops connection (e.g., 502 Bad Gateway) or network partitions.
//    - Fallback State: Executes `onerror`/`onclose` triggers, safely updating the UI state.
// ==============================================================================
export function useInvestigationStream(investigationId: string | null) {
  // Store stream chunks in a React state array
  const [logs, setLogs] = useState<string[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!investigationId) return;

    // 1. Establish Secure WebSocket handshake dynamically
    // This perfectly leverages the Nginx ^~ /api/investigations/.*/stream bypass block!
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host; 
    const wsUrl = `${protocol}//${host}/api/investigations/${investigationId}/stream`;

    console.log(`[WebSocket] Establishing unthrottled pipeline bypass: ${wsUrl}`);
    wsRef.current = new WebSocket(wsUrl);

    // 2. Lifecycle Hooks
    wsRef.current.onopen = () => {
      console.log(`[WebSocket] Live Pipeline Connected.`);
      setIsConnected(true);
    };

    wsRef.current.onmessage = (event) => {
      // 3. React Batching Optimization for "Full Blast" telemetry
      // Using functional state updates to avoid stale closure dependency bugs
      setLogs((prevLogs) => {
        // Enforce a strict memory ring-buffer ceiling of 1000 items
        // Prevents the browser DOM from freezing when thousands of events stream in.
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

    // 4. Memory Leak Cleanup
    // React strictly destroys the open socket if the component is unmounted
    return () => {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.close();
      }
    };
  }, [investigationId]);

  return { logs, isConnected };
}
