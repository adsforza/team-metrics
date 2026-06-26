import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ForecastCard } from './ForecastCard';
import type { ForecastResult } from '../../lib/api';

vi.mock('./ForecastHistogram', () => ({ ForecastHistogram: () => <div data-testid="histogram" /> }));

const result: ForecastResult = {
  items: 23, horizonDays: 14, lookbackDays: 84, trials: 10000, totalThroughput: 120,
  insufficientData: false,
  when: {
    conf50: { days: 8, date: '2026-07-03' },
    conf85: { days: 17, date: '2026-07-12' },
    conf95: { days: 23, date: '2026-07-18' },
    histogram: [{ x: 8, count: 100 }],
  },
  howMany: { conf50: 12, conf85: 8, conf95: 6, histogram: [{ x: 12, count: 100 }] },
};

const noop = () => {};
const baseProps = {
  forecast: result, loading: false,
  items: 23, setItems: noop, horizon: 14, setHorizon: noop,
};

describe('ForecastCard', () => {
  it('shows delivery dates in "when" mode', () => {
    render(<ForecastCard {...baseProps} mode="when" setMode={noop} />);
    expect(screen.getByText('2026-07-12')).toBeInTheDocument();
    expect(screen.getByText(/17 días/)).toBeInTheDocument();
  });

  it('shows item counts in "how many" mode', () => {
    render(<ForecastCard {...baseProps} mode="howMany" setMode={noop} />);
    expect(screen.getByText(/≥\s*8/)).toBeInTheDocument();
  });

  it('calls setMode when the other toggle is clicked', () => {
    const setMode = vi.fn();
    render(<ForecastCard {...baseProps} mode="when" setMode={setMode} />);
    fireEvent.click(screen.getByRole('button', { name: /Cuántos/ }));
    expect(setMode).toHaveBeenCalledWith('howMany');
  });

  it('shows an insufficient-data message', () => {
    render(<ForecastCard {...baseProps} mode="when" setMode={noop}
      forecast={{ ...result, insufficientData: true, when: null, howMany: null }} />);
    expect(screen.getByText(/Sin suficiente histórico/)).toBeInTheDocument();
  });
});
