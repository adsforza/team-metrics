import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ComparisonCard } from './ComparisonCard';
import type { ComparisonResult } from '../../lib/api';

const fixture: ComparisonResult = {
  week: '2026-06-22',
  prevWeek: '2026-06-15',
  throughput: { current: 12, previous: 9, delta: 3, deltaPct: 33 },
  wip: { current: 18, previous: 14, delta: 4, deltaPct: 29 },
};

describe('ComparisonCard', () => {
  it('renders both metric values', () => {
    render(<ComparisonCard result={fixture} loading={false} week={undefined} setWeek={() => {}} />);
    expect(screen.getByText('12')).toBeTruthy();
    expect(screen.getByText('9')).toBeTruthy();
    expect(screen.getByText('18')).toBeTruthy();
    expect(screen.getByText('14')).toBeTruthy();
  });

  it('shows the correct insight line for throughput↑ + wip↑', () => {
    render(<ComparisonCard result={fixture} loading={false} week={undefined} setWeek={() => {}} />);
    expect(screen.getByText(/velocidad de entrega no absorbió/)).toBeTruthy();
  });

  it('shows loading skeleton and no metric values when loading=true', () => {
    const { container } = render(<ComparisonCard result={null} loading={true} week={undefined} setWeek={() => {}} />);
    expect(container.querySelector('.animate-pulse')).toBeTruthy();
    expect(screen.queryByText('12')).toBeNull();
  });

  it('calls setWeek when the week selector changes', () => {
    const setWeek = vi.fn();
    render(<ComparisonCard result={fixture} loading={false} week="2026-06-22" setWeek={setWeek} />);
    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: '2026-06-15' } });
    expect(setWeek).toHaveBeenCalledWith('2026-06-15');
  });
});
