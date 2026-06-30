import { useEffect, useState } from 'react';
import { getDb, readScorecardMembers } from '../lib/db';
import { useSyncStore } from '../store/syncStore';
import type { PersonScorecard } from '../lib/types';

export function useTeam() {
  const dataVersion = useSyncStore(s => s.dataVersion);
  const [members, setMembers] = useState<PersonScorecard[]>([]);
  const [hasData, setHasData] = useState(false);

  useEffect(() => {
    (async () => {
      const db = await getDb();
      const rows = await readScorecardMembers(db);
      setMembers(rows);
      setHasData(rows.length > 0);
    })();
  }, [dataVersion]);

  return { members, hasData };
}
