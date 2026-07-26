// client/src/components/TeamTable/TeamTable.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TeamTable } from './TeamTable';
import type { TeamScorecardResponse } from '../../lib/api';

const dim = (value: number | null) => ({ value, previous: null, trend: 'flat' as const, improving: 'steady' as const });

const d0 = dim(0);
const ctx0 = { min: 0, median: 0, max: 0 };

const scorecard: TeamScorecardResponse = {
  team: { delivery: dim(11), predictability: dim(1.9), focus: dim(2.8), flow: dim(57), regressions: d0, blocked: d0 },
  members: [
    { member: { id: 'u1', display_name: 'Ana Gómez', email: 'a@t.com', avatar_url: null },
      delivery: dim(14), predictability: dim(1.4), focus: dim(2.1), flow: dim(68), regressions: d0, blocked: d0 },
  ],
  context: {
    delivery: { min: 0, median: 11, max: 14 },
    predictability: { min: 1.4, median: 1.9, max: 2.8 },
    focus: { min: 2.1, median: 2.8, max: 4.3 },
    flow: { min: 41, median: 57, max: 68 },
    regressions: ctx0,
    blocked: ctx0,
  },
};

describe('TeamTable', () => {
  it('renders a team aggregate row and one row per member', () => {
    render(<TeamTable scorecard={scorecard} loading={false} />);
    expect(screen.getByText('Equipo')).toBeInTheDocument();
    expect(screen.getByText('Ana Gómez')).toBeInTheDocument();
    expect(screen.getByText('Predecibilidad')).toBeInTheDocument();
  });

  it('shows an empty state when there are no members', () => {
    render(<TeamTable scorecard={{ ...scorecard, members: [] }} loading={false} />);
    expect(screen.getByText('Sin datos de equipo')).toBeInTheDocument();
  });

  it('defaults to alphabetical order and sorts by a column when its header is clicked', () => {
    const m = (id: string, name: string, delivery: number) => ({
      member: { id, display_name: name, email: `${id}@t.com`, avatar_url: null },
      delivery: dim(delivery), predictability: dim(2), focus: dim(2), flow: dim(90), regressions: d0, blocked: d0,
    });
    const sc: TeamScorecardResponse = {
      ...scorecard,
      // intentionally out of alphabetical order to prove the component sorts
      members: [m('u2', 'Beto', 9), m('u1', 'Ana', 1), m('u3', 'Carlos', 5)],
    };
    render(<TeamTable scorecard={sc} loading={false} />);

    // member rows are everything after the header row and the "Equipo" aggregate row
    const order = () =>
      screen.getAllByRole('row').slice(2).map(r => (r.textContent || '').match(/Ana|Beto|Carlos/)?.[0]);

    expect(order()).toEqual(['Ana', 'Beto', 'Carlos']);            // default: name asc

    fireEvent.click(screen.getByRole('button', { name: /Entrega/ }));
    expect(order()).toEqual(['Beto', 'Carlos', 'Ana']);            // delivery desc (9, 5, 1)

    fireEvent.click(screen.getByRole('button', { name: /Entrega/ }));
    expect(order()).toEqual(['Ana', 'Carlos', 'Beto']);            // toggle → delivery asc (1, 5, 9)
  });
});
