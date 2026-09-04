import { useEffect, useMemo, useState } from 'react';
import { getDb, readWorkloadIssues, listBoardSync, loadCoreMembers } from '../lib/db';
import { useSyncStore } from '../store/syncStore';
import { computeRequesterDetail } from '@teammetrics/core/workload';
import type { RequesterDetail } from '@teammetrics/core/workload';
import type { CoreIssueWorkload } from '@teammetrics/core/types';
import { AGING_THRESHOLD_DAYS } from '../lib/workloadView';

// Una sola lectura para toda la pantalla de detalle: el crudo de `issues` (compartido
// entre los dos scopes, que antes lo leian cada uno por su lado), el nombre del board
// (via `listBoardSync`, liviano — no el snapshot completo de `workload` que trae todos
// los squads/solicitantes solo para leer un label) y `team_members` crudo (no el
// snapshot de scorecard, que esta filtrado por la ventana del scorecard y puede dejar
// afuera a un assignee real). Todo en un unico `Promise.all` por entrada a la pantalla.
export function useRequesterScreenData(board: number): {
  issues: CoreIssueWorkload[] | null;
  boardName: string;
  memberMap: Record<string, string>;
  hasData: boolean;
} {
  const dataVersion = useSyncStore(s => s.dataVersion);
  const [issues, setIssues] = useState<CoreIssueWorkload[] | null>(null);
  const [boardName, setBoardName] = useState('');
  const [memberMap, setMemberMap] = useState<Record<string, string>>({});

  useEffect(() => {
    (async () => {
      const db = await getDb();
      const [rawIssues, boards, members] = await Promise.all([
        readWorkloadIssues(db),
        listBoardSync(db),
        loadCoreMembers(db),
      ]);
      setIssues(rawIssues);
      setBoardName(boards.find(b => b.id === board)?.name ?? '');
      const map: Record<string, string> = {};
      for (const m of members) map[m.id] = m.display_name;
      setMemberMap(map);
    })();
  }, [dataVersion, board]);

  return { issues, boardName, memberMap, hasData: issues !== null };
}

export interface UseRequesterDetailParams {
  board: number;
  requester: string | null;
  scope: 'pendientes' | 'todos';
  from?: string;
  to?: string;
}

// Corre computeRequesterDetail sobre un `issues` ya cargado (compartido entre las dos
// instancias de este hook, una por scope, en la pantalla) — no vuelve a tocar la base.
export function useRequesterDetail(
  issues: CoreIssueWorkload[] | null,
  params: UseRequesterDetailParams,
): { detail: RequesterDetail | null; hasData: boolean } {
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
  }, [issues, board, requester, scope, from, to]);

  return { detail, hasData: issues !== null };
}
