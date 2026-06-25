import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import type { ForecastResult } from '../lib/api';

export type ForecastMode = 'when' | 'howMany';

export function useForecast() {
  const [mode, setMode] = useState<ForecastMode>('when');
  const [items, setItems] = useState<number | undefined>(undefined); // undefined → server fills WIP default
  const [horizon, setHorizon] = useState<number>(14);
  const [forecast, setForecast] = useState<ForecastResult | null>(null);
  const [loading, setLoading] = useState(true);
  const adopted = useRef(false);

  useEffect(() => {
    setLoading(true);
    const handle = setTimeout(() => {
      api.forecast({
        items: items !== undefined ? String(items) : undefined,
        horizon: String(horizon),
      })
        .then(f => {
          setForecast(f);
          // adopt the server-provided WIP default into the input on first load
          if (!adopted.current && items === undefined) { adopted.current = true; setItems(f.items); }
          setLoading(false);
        })
        .catch(() => setLoading(false));
    }, 400);
    return () => clearTimeout(handle);
  }, [items, horizon]);

  return { mode, setMode, items, setItems, horizon, setHorizon, forecast, loading };
}
