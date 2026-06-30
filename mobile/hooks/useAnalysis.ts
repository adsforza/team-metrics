import { useEffect, useState } from 'react';
import { getDb, readBottleneck, readForecast, readCfd, readIssues } from '../lib/db';
import { useSyncStore } from '../store/syncStore';
import type { BottleneckResult, ForecastResult, CFDPoint, Issue } from '../lib/types';

interface AnalysisData {
  bottleneck: BottleneckResult | null;
  forecast: ForecastResult | null;
  cfd: CFDPoint[];
  issues: Issue[];
  hasData: boolean;
}

export function useAnalysis(): AnalysisData {
  const dataVersion = useSyncStore(s => s.dataVersion);
  const [data, setData] = useState<AnalysisData>({ bottleneck: null, forecast: null, cfd: [], issues: [], hasData: false });

  useEffect(() => {
    (async () => {
      const db = await getDb();
      const [bottleneck, forecast, cfd, issues] = await Promise.all([
        readBottleneck(db), readForecast(db), readCfd(db), readIssues(db),
      ]);
      setData({ bottleneck, forecast, cfd, issues, hasData: bottleneck !== null });
    })();
  }, [dataVersion]);

  return data;
}
