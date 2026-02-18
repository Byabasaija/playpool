// WebSocket hook for pool game communication.

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
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const MAX_RECONNECT_ATTEMPTS = 5;

  // Store callbacks in refs so connect() doesn't depend on them
  const onMessageRef = useRef(onMessage);
  const onOpenRef = useRef(onOpen);
  const onCloseRef = useRef(onClose);
  const onErrorRef = useRef(onError);

  useEffect(() => { onMessageRef.current = onMessage; }, [onMessage]);
  useEffect(() => { onOpenRef.current = onOpen; }, [onOpen]);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  useEffect(() => { onErrorRef.current = onError; }, [onError]);

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

    const wsUrl = `${baseUrl}/api/v1/game/${gameToken}/ws?token=${gameToken}&pt=${playerToken}`;
    console.log('[Pool WS] Connecting:', wsUrl);

    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      inProgressConnects.delete(key);
      console.log('[Pool WS] Connected');
      setConnected(true);
      reconnectAttemptsRef.current = 0;
      onOpenRef.current?.();
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as PoolWSMessage;
        onMessageRef.current(data);
      } catch (error) {
        console.error('[Pool WS] Parse error:', error);
      }
    };

    ws.onclose = (event) => {
      inProgressConnects.delete(key);
      setConnected(false);
      onCloseRef.current?.();

      if (event.reason?.includes('replaced by new connection')) return;
      if (!autoReconnect) return;

      if (reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
        reconnectAttemptsRef.current++;
        const delay = 1000 * reconnectAttemptsRef.current;
        console.log(`[Pool WS] Reconnecting in ${delay}ms (attempt ${reconnectAttemptsRef.current})`);
        reconnectTimerRef.current = setTimeout(connect, delay);
      }
    };

    ws.onerror = (error) => {
      console.error('[Pool WS] Error:', error);
      onErrorRef.current?.(error);
    };

    wsRef.current = ws;
  }, [gameToken, playerToken, autoReconnect]); // callbacks removed from deps

  useEffect(() => {
    connect();
    return () => {
      // Clear any pending reconnect timer
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      wsRef.current?.close();
    };
  }, [connect]);

  const send = useCallback((message: PoolOutgoingMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    }
  }, []);

  return { connected, send };
}
