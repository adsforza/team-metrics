import { useEffect, useState } from 'react';
import { getDb, readKpi, readThroughput, readComparison } from '../lib/db';
import { useSyncStore } from '../store/syncStore';
import type { KPIMetrics, ThroughputWeek, ComparisonResult } from '../lib/types';

interface KPIData {
  kpi: KPIMetrics | null;
  throughput: ThroughputWeek[];
  comparison: ComparisonResult | null;
  hasData: boolean;
}

export function useKPIs(): KPIData {
  const dataVersion = useSyncStore(s => s.dataVersion);
  const [data, setData] = useState<KPIData>({ kpi: null, throughput: [], comparison: null, hasData: false });

  useEffect(() => {
    (async () => {
      const db = await getDb();
      const [kpi, throughput, comparison] = await Promise.all([
        readKpi(db),
        readThroughput(db),
        readComparison(db),
      ]);
      setData({ kpi, throughput, comparison, hasData: kpi !== null });
    })();
  }, [dataVersion]);

  return data;
}
