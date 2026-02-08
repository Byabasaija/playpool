import { useNavigate } from 'react-router-dom';
import { useCallback } from 'react';

const API_BASE = '/api/v1/admin';

export function useAdminApi() {
  const navigate = useNavigate();

  const request = useCallback(async (
    method: string,
    path: string,
    body?: Record<string, unknown>
  ) => {
    const options: RequestInit = {
      method,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    const res = await fetch(`${API_BASE}${path}`, options);

    if (res.status === 401) {
      navigate('/pm-admin');
      throw new Error('Session expired');
    }

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Request failed');
    }

    return data;
  }, [navigate]);

  const get = useCallback((path: string, params?: Record<string, string | number>) => {
    let url = path;
    if (params) {
      const searchParams = new URLSearchParams();
      Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== '' && v !== null) {
          searchParams.set(k, String(v));
        }
      });
      const qs = searchParams.toString();
      if (qs) url += '?' + qs;
    }
    return request('GET', url);
  }, [request]);

  const post = useCallback((path: string, body?: Record<string, unknown>) => {
    return request('POST', path, body);
  }, [request]);

  const put = useCallback((path: string, body?: Record<string, unknown>) => {
    return request('PUT', path, body);
  }, [request]);

  return { get, post, put };
}

// Standalone login functions (no auth cookie needed yet)
export async function adminLogin(username: string, password: string) {
  const res = await fetch(`${API_BASE}/login`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Login failed');
  return data;
}

export async function adminVerifyOTP(username: string, otp: string) {
  const res = await fetch(`${API_BASE}/verify-otp`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, otp }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'OTP verification failed');
  return data;
}

export async function adminCheckSession() {
  const res = await fetch(`${API_BASE}/me`, {
    credentials: 'include',
  });
  if (!res.ok) return null;
  return res.json();
}

export async function adminLogout() {
  await fetch(`${API_BASE}/logout`, {
    method: 'POST',
    credentials: 'include',
  });
}
