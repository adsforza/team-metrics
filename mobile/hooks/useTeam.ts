import { useEffect, useState } from 'react';
import { getDb, readScorecardMembers, readScorecardContext } from '../lib/db';
import { useSyncStore } from '../store/syncStore';
import type { PersonScorecard, TeamScorecardResponse } from '../lib/types';

export function useTeam() {
  const dataVersion = useSyncStore(s => s.dataVersion);
  const [members, setMembers] = useState<PersonScorecard[]>([]);
  const [ctx, setCtx] = useState<TeamScorecardResponse['context'] | null>(null);
  const [hasData, setHasData] = useState(false);

  useEffect(() => {
    (async () => {
      const db = await getDb();
      const [rows, context] = await Promise.all([
        readScorecardMembers(db),
        readScorecardContext(db),
      ]);
      setMembers(rows);
      setCtx(context);
      setHasData(rows.length > 0);
    })();
  }, [dataVersion]);

  return { members, ctx, hasData };
}
