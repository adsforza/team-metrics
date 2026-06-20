// client/src/components/TeamTable/TeamTable.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TeamTable } from './TeamTable';
import type { TeamScorecardResponse } from '../../lib/api';

const dim = (value: number | null) => ({ value, previous: null, trend: 'flat' as const, improving: 'steady' as const });

const scorecard: TeamScorecardResponse = {
  team: { delivery: dim(11), predictability: dim(1.9), focus: dim(2.8), flow: dim(57) },
  members: [
    { member: { id: 'u1', display_name: 'Ana Gómez', email: 'a@t.com', avatar_url: null },
      delivery: dim(14), predictability: dim(1.4), focus: dim(2.1), flow: dim(68) },
  ],
  context: {
    delivery: { min: 0, median: 11, max: 14 },
    predictability: { min: 1.4, median: 1.9, max: 2.8 },
    focus: { min: 2.1, median: 2.8, max: 4.3 },
    flow: { min: 41, median: 57, max: 68 },
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
});
