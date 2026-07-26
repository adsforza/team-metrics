import { useEffect, useState } from 'react';
import { useFilters } from '../store/filters';
import { api } from '../lib/api';
import type { TeamScorecardResponse, TeamMember } from '../lib/api';

const NULL_DIM = { value: null, previous: null, trend: 'flat' as const, improving: 'steady' as const };
const NULL_CTX = { min: 0, median: 0, max: 0 };

const EMPTY: TeamScorecardResponse = {
  team: {
    delivery: NULL_DIM, predictability: NULL_DIM, focus: NULL_DIM,
    flow: NULL_DIM, regressions: NULL_DIM, blocked: NULL_DIM,
  },
  members: [],
  context: {
    delivery: NULL_CTX, predictability: NULL_CTX, focus: NULL_CTX,
    flow: NULL_CTX, regressions: NULL_CTX, blocked: NULL_CTX,
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
