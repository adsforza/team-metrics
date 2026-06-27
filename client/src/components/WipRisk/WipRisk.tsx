import { useWipRisk } from '../../hooks/useWipRisk';
import { WipRiskCard } from './WipRiskCard';

export function WipRisk() {
  const { result, loading } = useWipRisk();
  return <WipRiskCard result={result} loading={loading} />;
}
