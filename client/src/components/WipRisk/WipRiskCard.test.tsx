import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { WipRiskCard } from './WipRiskCard';
import type { WipRiskResult } from '../../lib/api';

const base: WipRiskResult = {
  lookbackDays: 84,
  limits: [
    { talla: 'S', limit_days: 1.9, sample_count: 8 },
    { talla: 'M', limit_days: 2.0, sample_count: 12 },
    { talla: 'L', limit_days: 6.1, sample_count: 6 },
    { talla: 'XL', limit_days: null, sample_count: 2 },
  ],
  items: [
    { issue_id: 'OPS-142', title: 'Migrar auth', talla: 'L', status: 'In Progress', assignee_id: 'u1', age_days: 9.4, limit_days: 6.1, ratio: 1.54, level: 'excedido' },
    { issue_id: 'OPS-201', title: 'Ajustar dash', talla: 'S', status: 'In Progress', assignee_id: 'u2', age_days: 1.6, limit_days: 1.9, ratio: 0.84, level: 'en_riesgo' },
  ],
  counts: { en_riesgo: 1, excedido: 1, sin_limite: 1 },
};

describe('WipRiskCard', () => {
  it('renders the count line and one row per item', () => {
    render(<WipRiskCard result={base} loading={false} />);
    expect(screen.getByText(/1 en riesgo/)).toBeInTheDocument();
    expect(screen.getByText(/1 excedido/)).toBeInTheDocument();
    expect(screen.getByText('OPS-142')).toBeInTheDocument();
    expect(screen.getByText('OPS-201')).toBeInTheDocument();
  });

  it('shows the empty state when there are no at-risk items', () => {
    render(<WipRiskCard result={{ ...base, items: [], counts: { en_riesgo: 0, excedido: 0, sin_limite: 0 } }} loading={false} />);
    expect(screen.getByText(/Nada en riesgo/)).toBeInTheDocument();
  });

  it('shows a loading skeleton while loading', () => {
    const { container } = render(<WipRiskCard result={null} loading={true} />);
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
  });
});
