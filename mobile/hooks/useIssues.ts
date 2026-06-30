import { useEffect, useState } from 'react';
import { getDb, readWipRisk, readAgingIssues } from '../lib/db';
import { useSyncStore } from '../store/syncStore';
import { useFilterStore } from '../store/filterStore';
import type { WipRiskResult, AgingIssue } from '../lib/types';

export function useIssues() {
  const dataVersion = useSyncStore(s => s.dataVersion);
  const { assignee, talla } = useFilterStore();
  const [wipRisk, setWipRisk] = useState<WipRiskResult | null>(null);
  const [aging, setAging] = useState<AgingIssue[]>([]);
  const [hasData, setHasData] = useState(false);

  useEffect(() => {
    (async () => {
      const db = await getDb();
      const [risk, ag] = await Promise.all([readWipRisk(db), readAgingIssues(db)]);
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

  return { wipRisk, aging, hasData };
}
