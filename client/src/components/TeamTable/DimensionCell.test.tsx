// client/src/components/TeamTable/DimensionCell.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DimensionCell } from './DimensionCell';
import type { DimensionValue, DimensionContext } from '../../lib/api';

const ctx: DimensionContext = { min: 0, median: 5, max: 10 };

describe('DimensionCell', () => {
  it('renders an em dash for null values', () => {
    const dim: DimensionValue = { value: null, previous: null, trend: 'flat', improving: 'steady' };
    render(<DimensionCell dim={dim} context={ctx} format={v => `${v}`} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('shows the formatted value and an up arrow when trend is up', () => {
    const dim: DimensionValue = { value: 14, previous: 10, trend: 'up', improving: 'better' };
    render(<DimensionCell dim={dim} context={ctx} format={v => `${v}`} />);
    expect(screen.getByText('14')).toBeInTheDocument();
    expect(screen.getByLabelText('mejora')).toBeInTheDocument();
  });

  it('labels a worsening trend distinctly from an improving one', () => {
    const dim: DimensionValue = { value: 4, previous: 2, trend: 'up', improving: 'worse' };
    render(<DimensionCell dim={dim} context={ctx} format={v => `${v}`} />);
    expect(screen.getByLabelText('empeora')).toBeInTheDocument();
  });
});
