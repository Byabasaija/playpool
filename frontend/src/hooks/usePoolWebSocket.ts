// Pool-specific WebSocket hook — wraps the generic useWebSocket with pool-ws endpoint.

import { useEffect, useRef, useState, useCallback } from 'react';
import { PoolWSMessage, PoolOutgoingMessage } from '../types/pool.types';

const inProgressConnects = new Set<string>();

interface UsePoolWebSocketProps {
  gameToken: string;
  playerToken: string;
  onMessage: (message: PoolWSMessage) => void;
  onOpen?: () => void;
  onClose?: () => void;
  onError?: (error: Event) => void;
  autoReconnect?: boolean;
}

export function usePoolWebSocket({
  gameToken, playerToken, onMessage, onOpen, onClose, onError, autoReconnect = true,
}: UsePoolWebSocketProps) {
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const MAX_RECONNECT_ATTEMPTS = 5;

  const connect = useCallback(() => {
    if (!gameToken || !playerToken) return;

    const key = `pool:${gameToken}:${playerToken}`;
    if (inProgressConnects.has(key)) return;

    if (wsRef.current) {
      const state = wsRef.current.readyState;
      if (state === WebSocket.OPEN) { setConnected(true); return; }
      if (state === WebSocket.CONNECTING) return;
      try { wsRef.current.close(); } catch (e) {}
    }

    inProgressConnects.add(key);

    const envBase = ((import.meta as any).env && (import.meta as any).env.VITE_WS_BASE_URL) || '';
    let baseUrl = '';
    if (envBase) {
      if (envBase.startsWith('ws://') || envBase.startsWith('wss://')) {
        baseUrl = envBase.replace(/\/$/, '');
      } else {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        baseUrl = `${protocol}//${envBase.replace(/\/$/, '')}`;
      }
    } else {
      baseUrl = 'ws://localhost:8000';
    }

    // Use pool-ws endpoint
    const wsUrl = `${baseUrl}/api/v1/game/${gameToken}/pool-ws?token=${gameToken}&pt=${playerToken}`;
    console.log('[Pool WS] Connecting:', wsUrl);

    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      inProgressConnects.delete(key);
      console.log('[Pool WS] Connected');
      setConnected(true);
      reconnectAttemptsRef.current = 0;
      onOpen?.();
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as PoolWSMessage;
        onMessage(data);
      } catch (error) {
        console.error('[Pool WS] Parse error:', error);
      }
    };

    ws.onclose = (event) => {
      inProgressConnects.delete(key);
      setConnected(false);
      onClose?.();

      if (event.reason?.includes('replaced by new connection')) return;
      if (!autoReconnect) return;

      if (reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
        reconnectAttemptsRef.current++;
        setTimeout(connect, 1000 * reconnectAttemptsRef.current);
      }
    };

    ws.onerror = (error) => {
      console.error('[Pool WS] Error:', error);
      onError?.(error);
    };

    wsRef.current = ws;
  }, [gameToken, playerToken, onMessage, onOpen, onClose, onError, autoReconnect]);

  useEffect(() => {
    connect();
    return () => { wsRef.current?.close(); };
  }, [connect]);

  const send = useCallback((message: PoolOutgoingMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    }
  }, []);

  return { connected, send };
}
