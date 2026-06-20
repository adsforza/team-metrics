import { useEffect, useState } from 'react';
import { useFilters } from '../store/filters';
import { api } from '../lib/api';
import type { TeamScorecardResponse, TeamMember } from '../lib/api';

const EMPTY: TeamScorecardResponse = {
  team: {
    delivery: { value: null, previous: null, trend: 'flat', improving: 'steady' },
    predictability: { value: null, previous: null, trend: 'flat', improving: 'steady' },
    focus: { value: null, previous: null, trend: 'flat', improving: 'steady' },
    flow: { value: null, previous: null, trend: 'flat', improving: 'steady' },
  },
  members: [],
  context: {
    delivery: { min: 0, median: 0, max: 0 },
    predictability: { min: 0, median: 0, max: 0 },
    focus: { min: 0, median: 0, max: 0 },
    flow: { min: 0, median: 0, max: 0 },
  },
};

export function useTeam() {
  const filters = useFilters(s => ({ timeRange: s.timeRange, customFrom: s.customFrom, customTo: s.customTo, talla: s.talla }));
  const toQueryParams = useFilters(s => s.toQueryParams);
  const [scorecard, setScorecard] = useState<TeamScorecardResponse>(EMPTY);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const { from, to, talla } = toQueryParams();
    Promise.all([api.team({ from, to, talla }), api.teamMembers()])
      .then(([t, m]) => { setScorecard(t); setMembers(m); setLoading(false); })
      .catch(() => setLoading(false));
  }, [filters.timeRange, filters.customFrom, filters.customTo, filters.talla]);

  return { scorecard, members, loading };
}
