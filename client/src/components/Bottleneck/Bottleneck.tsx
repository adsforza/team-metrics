import { useBottleneck } from '../../hooks/useBottleneck';
import { BottleneckCard } from './BottleneckCard';

export function Bottleneck() {
  const { result, loading } = useBottleneck();
  return <BottleneckCard result={result} loading={loading} />;
}
