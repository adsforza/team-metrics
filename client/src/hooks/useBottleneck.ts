import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { BottleneckResult } from '../lib/api';

export function useBottleneck() {
  const [result, setResult] = useState<BottleneckResult | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    api.bottleneck()
      .then(r => { if (active) { setResult(r); setLoading(false); } })
      .catch(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  return { result, loading };
}
