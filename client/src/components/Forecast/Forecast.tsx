import { useForecast } from '../../hooks/useForecast';
import { ForecastCard } from './ForecastCard';

export function Forecast() {
  const f = useForecast();
  return (
    <ForecastCard
      forecast={f.forecast}
      loading={f.loading}
      mode={f.mode}
      setMode={f.setMode}
      items={f.items}
      setItems={f.setItems}
      horizon={f.horizon}
      setHorizon={f.setHorizon}
    />
  );
}
