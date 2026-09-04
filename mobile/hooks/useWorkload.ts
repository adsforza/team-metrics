import { useEffect, useState } from 'react';
import { getDb, readWorkload } from '../lib/db';
import { useSyncStore } from '../store/syncStore';
import type { WorkloadResult } from '@teammetrics/core/workload';

export function useWorkload(): { workload: WorkloadResult | null; hasData: boolean } {
  const dataVersion = useSyncStore(s => s.dataVersion);
  const [workload, setWorkload] = useState<WorkloadResult | null>(null);
  useEffect(() => {
    (async () => setWorkload(await readWorkload(await getDb())))();
  }, [dataVersion]);
  return { workload, hasData: workload !== null };
}
