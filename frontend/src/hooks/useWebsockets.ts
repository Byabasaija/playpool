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

    if (wsRef.current?.readyState === WebSocket.CONNECTING) {
      console.log('WebSocket connection already in progress');
      return;
    }

    if (wsRef.current) {
      wsRef.current.close();
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
      // Clear in-progress flag when open
      inProgressConnects.delete(key);
      console.log('WebSocket connected');
      setConnected(true);
      reconnectAttemptsRef.current = 0; 
      onOpen?.();
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as WSMessage;
        console.log('Received:', data);

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

    ws.onclose = (event) => {
      // Clear any in-progress flag on close
      inProgressConnects.delete(key);
      console.log('WebSocket disconnected with code:', event.code, 'reason:', event.reason, 'wasClean:', event.wasClean);
      setConnected(false);
      onClose?.();

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
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    } else {
      console.error('WebSocket is not connected');
    }
  }, []);

  return { connected, send };
}