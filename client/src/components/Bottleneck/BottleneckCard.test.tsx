import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BottleneckCard } from './BottleneckCard';
import type { BottleneckResult } from '../../lib/api';

const fixture: BottleneckResult = {
  lookbackWeeks: 8,
  total_active: 15,
  states: [
    {
      status: 'In Review',
      queue_size: 10,
      avg_days: 6.1,
      score: 'crítico',
      detail: {
        p85_days: 14.2,
        pct_of_wip: 10 / 15,
        trend_pct: 97,
        trend: [
          { week: '2026-06-08', avg_days: 3.1 },
          { week: '2026-06-15', avg_days: 4.5 },
          { week: '2026-06-22', avg_days: 6.1 },
        ],
        top_issues: [
          { issue_id: 'OPS-1133', title: 'Token solo lectura', talla: 'M', days_in_state: 21 },
          { issue_id: 'OPS-2041', title: 'Migrar auth OAuth2', talla: 'L', days_in_state: 18 },
        ],
        by_talla: [
          { talla: 'M', avg_days: 5.1, count: 3 },
          { talla: 'L', avg_days: 8.4, count: 2 },
        ],
      },
    },
    {
      status: 'To Do',
      queue_size: 5,
      avg_days: 1.0,
      score: 'normal',
      detail: {
        p85_days: 2.0,
        pct_of_wip: 5 / 15,
        trend_pct: null,
        trend: [],
        top_issues: [],
        by_talla: [],
      },
    },
  ],
};

describe('BottleneckCard', () => {
  it('renders one row per state with correct status, queue, avg_days, and score', () => {
    render(<BottleneckCard result={fixture} loading={false} />);
    expect(screen.getByText('In Review')).toBeInTheDocument();
    expect(screen.getByText('To Do')).toBeInTheDocument();
    expect(screen.getByText('● crítico')).toBeInTheDocument();
    expect(screen.getByText('● normal')).toBeInTheDocument();
    expect(screen.getByText('10')).toBeInTheDocument();
    expect(screen.getByText('6.1d')).toBeInTheDocument();
  });

  it('expands detail panel on row click and collapses on second click', () => {
    render(<BottleneckCard result={fixture} loading={false} />);
    const row = screen.getByText('In Review').closest('tr')!;

    fireEvent.click(row);
    expect(screen.getByText('OPS-1133')).toBeInTheDocument();
    expect(screen.getByText('Issues con más tiempo aquí')).toBeInTheDocument();

    fireEvent.click(row);
    expect(screen.queryByText('OPS-1133')).not.toBeInTheDocument();
  });

  it('renders a loading skeleton when loading=true', () => {
    const { container } = render(<BottleneckCard result={null} loading={true} />);
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
  });
});
