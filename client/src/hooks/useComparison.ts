import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { ComparisonResult } from '../lib/api';

export function useComparison(week: string | undefined) {
  const [result, setResult] = useState<ComparisonResult | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    api.comparison(week)
      .then(r => { if (active) { setResult(r); setLoading(false); } })
      .catch(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [week]);

  return { result, loading };
}
