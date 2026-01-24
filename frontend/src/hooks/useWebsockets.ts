import { useEffect, useRef, useState, useCallback } from 'react';
import { WSMessage, OutgoingWSMessage } from '../types/websocket.types';

interface UseWebSocketProps {
  gameToken: string;
  playerToken: string;
  onMessage: (message: WSMessage) => void;
  onOpen?: () => void;
  onClose?: () => void;
  onError?: (error: Event) => void;
}

// Track in-progress connections to avoid duplicate connects (dev StrictMode mount double-invoke)
const inProgressConnects = new Set<string>();

export function useWebSocket({
  gameToken,
  playerToken,
  onMessage,
  onOpen,
  onClose,
  onError,
  autoReconnect = true
}: UseWebSocketProps & { autoReconnect?: boolean }) {
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const MAX_RECONNECT_ATTEMPTS = 5;
  const sendQueueRef = useRef<OutgoingWSMessage[]>([]);
  const MAX_SEND_QUEUE = 64;
  const FLUSH_FALLBACK_MS = 1000;
  const FLUSH_AFTER_READY_MS = 150;
  const fallbackFlushRef = useRef<number | null>(null);
  const readyFlushTimerRef = useRef<number | null>(null);
  const isReadyRef = useRef(false);

  const flushQueue = useCallback(() => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) return;
    try {
      while (sendQueueRef.current.length > 0 && wsRef.current?.readyState === WebSocket.OPEN) {
        const m = sendQueueRef.current.shift()!;
        wsRef.current.send(JSON.stringify(m));
      }
    } catch (e) {
      console.error('Failed to flush send queue:', e);
    }
  }, []);

  const connect = useCallback(() => {
    // Don't connect if tokens are missing
    if (!gameToken || !playerToken) {
      console.log('Skipping WebSocket connection - missing tokens');
      return;
    }

    const key = `${gameToken}:${playerToken}`;

    // Prevent duplicate immediate connects for same game/player (helps in dev mode/StrictMode)
    if (inProgressConnects.has(key)) {
      console.log('Connect already in progress for', key);
      return;
    }

    // If we already have a WebSocket instance, avoid tearing down an OPEN one
    if (wsRef.current) {
      const state = wsRef.current.readyState;
      if (state === WebSocket.OPEN) {
        console.log('WebSocket already OPEN for', key);
        setConnected(true);
        return;
      }
      if (state === WebSocket.CONNECTING) {
        console.log('WebSocket connection already in progress for', key);
        return;
      }
      // If it's CLOSING/CLOSED, attempt a safe close then proceed to create a new socket
      try {
        wsRef.current.close();
      } catch (e) {
        // ignore
      }
    }

    inProgressConnects.add(key);

    // Determine base URL for WebSocket
    const envBase = ((import.meta as any).env && (import.meta as any).env.VITE_WS_BASE_URL) || '';
    let baseUrl = '';
    if (envBase) {
      // If envBase includes protocol (ws:// or wss://), use it as-is
      if (envBase.startsWith('ws://') || envBase.startsWith('wss://')) {
        baseUrl = envBase.replace(/\/$/, '');
      } else {
        // Otherwise, derive protocol from current page
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        baseUrl = `${protocol}//${envBase.replace(/\/$/, '')}`;
      }
    } else {
      // Default to localhost dev server
      baseUrl = "ws://localhost:8000";
    }

    const wsUrl = `${baseUrl}/api/v1/game/${gameToken}/ws?token=${gameToken}&pt=${playerToken}`;

    console.log('Connecting to WebSocket:', wsUrl);

    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      // Clear any pending fallback timer
      if (fallbackFlushRef.current) {
        window.clearTimeout(fallbackFlushRef.current);
        fallbackFlushRef.current = null;
      }

      // Clear in-progress flag when open
      inProgressConnects.delete(key);
      console.log('WebSocket connected');
      setConnected(true);
      reconnectAttemptsRef.current = 0;
      onOpen?.();

      // Reset ready state and setup a fallback flush in case server doesn't send a game_state
      isReadyRef.current = false;
      if (fallbackFlushRef.current) {
        window.clearTimeout(fallbackFlushRef.current);
        fallbackFlushRef.current = null;
      }
      fallbackFlushRef.current = window.setTimeout(() => {
        console.log('Flush fallback timeout reached, flushing queued messages');
        isReadyRef.current = true;
        flushQueue();
        fallbackFlushRef.current = null;
      }, FLUSH_FALLBACK_MS);
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as WSMessage;
        console.log('Received:', data);

        // If we get a game_state/game_update, mark connection as "ready" and schedule flushing queued messages
        if ((data.type === 'game_state' || data.type === 'game_update') && !isReadyRef.current) {
          isReadyRef.current = true;
          if (fallbackFlushRef.current) {
            window.clearTimeout(fallbackFlushRef.current);
            fallbackFlushRef.current = null;
          }

          // Schedule a small delay to flush queue so connection can stabilize
          if (readyFlushTimerRef.current) {
            window.clearTimeout(readyFlushTimerRef.current);
            readyFlushTimerRef.current = null;
          }
          readyFlushTimerRef.current = window.setTimeout(() => {
            flushQueue();
            if (readyFlushTimerRef.current) {
              window.clearTimeout(readyFlushTimerRef.current);
              readyFlushTimerRef.current = null;
            }
          }, FLUSH_AFTER_READY_MS);
        }

        // Forward display names if present
        if (data.my_display_name || data.opponent_display_name) {
          // merge into message
          onMessage(data);
        } else {
          onMessage(data);
        }
      } catch (error) {
        console.error('Error parsing WebSocket message:', error);
      }
    };

    ws.onclose = (event: CloseEvent) => {
      // Clear any pending timers
      if (fallbackFlushRef.current) {
        window.clearTimeout(fallbackFlushRef.current);
        fallbackFlushRef.current = null;
      }
      if (readyFlushTimerRef.current) {
        window.clearTimeout(readyFlushTimerRef.current);
        readyFlushTimerRef.current = null;
      }

      // Clear any in-progress flag on close
      inProgressConnects.delete(key);
      console.log('WebSocket disconnected with code:', event.code, 'reason:', event.reason, 'wasClean:', event.wasClean);
      setConnected(false);
      onClose?.();

      // If the server explicitly replaced this connection, do not auto-reconnect
      if (event.reason && event.reason.includes('replaced by new connection')) {
        console.log('Connection closed due to replacement; not attempting reconnect for', key);
        return;
      }

      if (!autoReconnect) {
        console.log('Auto-reconnect disabled; not attempting reconnect');
        return;
      }

      // Attempt reconnect
      if (reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
        reconnectAttemptsRef.current++;
        setTimeout(connect, 1000 * reconnectAttemptsRef.current);
      }
    };

    ws.onerror = (error) => {
      console.error('WebSocket error event:', error);
      onError?.(error);
    };

    wsRef.current = ws;
  }, [gameToken, playerToken, onMessage, onOpen, onClose, onError, autoReconnect]);

  useEffect(() => {
    connect();

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [connect]);

  const send = useCallback((message: OutgoingWSMessage) => {
    // If socket is open send immediately
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
      return;
    }

    // Otherwise queue the message and attempt to connect
    const q = sendQueueRef.current;
    if (q.length >= MAX_SEND_QUEUE) {
      // drop oldest to keep memory bounded
      q.shift();
    }
    q.push(message);
    console.log('WebSocket not open, queued message. queue_len=', q.length);

    // Try to connect if not already in progress
    try {
      connect();
    } catch (e) {}
  }, [connect]);

  return { connected, send };
}