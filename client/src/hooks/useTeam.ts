import { useEffect, useState } from 'react';
import { useFilters } from '../store/filters';
import { api } from '../lib/api';
import type { PersonMetrics, TeamMember } from '../lib/api';

export function useTeam() {
  const filters = useFilters(s => ({ timeRange: s.timeRange, talla: s.talla }));
  const toQueryParams = useFilters(s => s.toQueryParams);
  const [team, setTeam] = useState<PersonMetrics[]>([]);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const { from, to, talla } = toQueryParams();
    Promise.all([api.team({ from, to, talla }), api.teamMembers()])
      .then(([t, m]) => { setTeam(t); setMembers(m); setLoading(false); })
      .catch(() => setLoading(false));
  }, [filters.timeRange, filters.talla]);

  return { team, members, loading };
}
