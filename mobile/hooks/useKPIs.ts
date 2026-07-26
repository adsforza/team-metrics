import { useEffect, useState } from 'react';
import {
  getDb, readKpi, readThroughput, readComparison,
  readComparisonWeeks, readCycleTimeByTalla,
} from '../lib/db';
import { useSyncStore } from '../store/syncStore';
import type { KPIMetrics, ThroughputWeek, ComparisonResult } from '../lib/types';

interface KPIData {
  kpi: KPIMetrics | null;
  throughput: ThroughputWeek[];
  comparison: ComparisonResult | null;
  availableWeeks: string[];
  ctByTalla: Record<string, number | null>;
  hasData: boolean;
}

export function useKPIs(selectedWeek?: string): KPIData {
  const dataVersion = useSyncStore(s => s.dataVersion);
  const [data, setData] = useState<KPIData>({
    kpi: null, throughput: [], comparison: null,
    availableWeeks: [], ctByTalla: {}, hasData: false,
  });

  useEffect(() => {
    (async () => {
      const db = await getDb();
      const [kpi, throughput, comparison, weeks, ctByTalla] = await Promise.all([
        readKpi(db),
        readThroughput(db),
        readComparison(db, selectedWeek),
        readComparisonWeeks(db),
        readCycleTimeByTalla(db),
      ]);
      setData({ kpi, throughput, comparison, availableWeeks: weeks, ctByTalla, hasData: kpi !== null });
    })();
  }, [dataVersion, selectedWeek]);

  return data;
}
