import { useEffect, useMemo, useState } from 'react';
import { getDb, readWorkloadIssues } from '../lib/db';
import { useSyncStore } from '../store/syncStore';
import { computeRequesterDetail } from '@teammetrics/core/workload';
import type { RequesterDetail } from '@teammetrics/core/workload';
import type { CoreIssueWorkload } from '@teammetrics/core/types';

export const AGING_THRESHOLD_DAYS = 7;

export interface UseRequesterDetailParams {
  board: number;
  requester: string | null;
  scope: 'pendientes' | 'todos';
  from?: string;
  to?: string;
}

export function useRequesterDetail(
  params: UseRequesterDetailParams,
): { detail: RequesterDetail | null; hasData: boolean } {
  const dataVersion = useSyncStore(s => s.dataVersion);
  const [issues, setIssues] = useState<CoreIssueWorkload[] | null>(null);

  useEffect(() => {
    (async () => setIssues(await readWorkloadIssues(await getDb())))();
  }, [dataVersion]);

  const { board, requester, scope, from, to } = params;

  const detail = useMemo(() => {
    if (issues === null) return null;
    return computeRequesterDetail(issues, {
      board_id: board,
      requester,
      scope,
      from,
      to,
      agingThresholdDays: AGING_THRESHOLD_DAYS,
      now: new Date(),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issues, dataVersion, board, requester, scope, from, to]);

  return { detail, hasData: issues !== null };
}
