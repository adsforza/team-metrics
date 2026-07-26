import { useEffect, useState } from 'react';
import { getDb, readWipRisk, readAgingIssues, readTeamMemberNames } from '../lib/db';
import { useSyncStore } from '../store/syncStore';
import { useFilterStore } from '../store/filterStore';
import type { WipRiskResult, AgingIssue } from '../lib/types';

export function useIssues() {
  const dataVersion = useSyncStore(s => s.dataVersion);
  const { assignee, talla } = useFilterStore();
  const [wipRisk, setWipRisk] = useState<WipRiskResult | null>(null);
  const [aging, setAging] = useState<AgingIssue[]>([]);
  const [memberMap, setMemberMap] = useState<Record<string, string>>({});
  const [hasData, setHasData] = useState(false);

  useEffect(() => {
    (async () => {
      const db = await getDb();
      const [risk, ag, members] = await Promise.all([
        readWipRisk(db),
        readAgingIssues(db),
        readTeamMemberNames(db),
      ]);

      const map: Record<string, string> = {};
      for (const m of members) map[m.id] = m.name;
      setMemberMap(map);

      let filteredRisk = risk;
      let filteredAging = ag;

      if (risk && (assignee || talla)) {
        filteredRisk = {
          ...risk,
          items: risk.items.filter(i =>
            (!assignee || i.assignee_id === assignee) &&
            (!talla || i.talla === talla)
          ),
        };
      }
      if (assignee || talla) {
        filteredAging = ag.filter(i =>
          (!assignee || i.assignee_id === assignee) &&
          (!talla || i.talla === talla)
        );
      }

      setWipRisk(filteredRisk);
      setAging(filteredAging);
      setHasData(risk !== null);
    })();
  }, [dataVersion, assignee, talla]);

  return { wipRisk, aging, memberMap, hasData };
}
