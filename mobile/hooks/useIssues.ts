import { useEffect, useState } from 'react';
import { getDb, readWipRisk, readAgingIssues, readTeamMemberNames } from '../lib/db';
import { useSyncStore } from '../store/syncStore';
import { useFilterStore } from '../store/filterStore';
import type { WipRiskResult, AgingIssue } from '../lib/types';

export function useIssues() {
  const dataVersion = useSyncStore(s => s.dataVersion);
  const { assignees, talla } = useFilterStore();
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

      // [] = todos (ver comentario en filterStore.ts).
      const matchesAssignee = (id: string | null) => assignees.length === 0 || (id != null && assignees.includes(id));

      if (risk && (assignees.length > 0 || talla)) {
        filteredRisk = {
          ...risk,
          items: risk.items.filter(i =>
            matchesAssignee(i.assignee_id) &&
            (!talla || i.talla === talla)
          ),
        };
      }
      if (assignees.length > 0 || talla) {
        filteredAging = ag.filter(i =>
          matchesAssignee(i.assignee_id) &&
          (!talla || i.talla === talla)
        );
      }

      setWipRisk(filteredRisk);
      setAging(filteredAging);
      setHasData(risk !== null);
    })();
  }, [dataVersion, assignees, talla]);

  return { wipRisk, aging, memberMap, hasData };
}
