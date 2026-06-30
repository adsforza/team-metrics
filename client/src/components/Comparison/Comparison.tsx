import { useState } from 'react';
import { useComparison } from '../../hooks/useComparison';
import { ComparisonCard } from './ComparisonCard';

export function Comparison() {
  const [week, setWeek] = useState<string | undefined>(undefined);
  const { result, loading } = useComparison(week);
  return <ComparisonCard result={result} loading={loading} week={week} setWeek={setWeek} />;
}
