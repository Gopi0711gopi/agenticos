import { useState, useEffect, useCallback } from 'react';

const API = '/api';

export function useApi<T>(endpoint: string, interval = 0): { data: T | null; loading: boolean; error: string | null; refresh: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setLoading(true);
    fetch(`${API}${endpoint}`)
      .then(r => r.json())
      .then(d => { setData(d); setError(null); })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [endpoint]);

  useEffect(() => {
    refresh();
    if (interval > 0) {
      const id = setInterval(refresh, interval);
      return () => clearInterval(id);
    }
  }, [refresh, interval]);

  return { data, loading, error, refresh };
}

export async function postApi<T>(endpoint: string, body: Record<string, unknown>): Promise<T> {
  const r = await fetch(`${API}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return r.json();
}
