import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { WipRiskResult } from '../lib/api';

export function useWipRisk() {
  const [result, setResult] = useState<WipRiskResult | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    api.wipRisk()
      .then(r => { if (active) { setResult(r); setLoading(false); } })
      .catch(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  return { result, loading };
}
