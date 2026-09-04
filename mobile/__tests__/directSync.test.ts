jest.mock('../lib/db', () => ({
  upsertRawIssues: jest.fn().mockResolvedValue(undefined),
  getRawSince: jest.fn(),
  setBoardLastSync: jest.fn().mockResolvedValue(undefined),
  readUnclassifiedIssues: jest.fn(),
  updateIssueTallas: jest.fn().mockResolvedValue(undefined),
  loadCoreIssues: jest.fn(),
  loadCoreTransitions: jest.fn(),
  loadCoreMembers: jest.fn(),
  listBoardSync: jest.fn().mockResolvedValue([]),
}));

jest.mock('../lib/snapshots', () => ({
  writeSnapshots: jest.fn().mockResolvedValue(undefined),
}));

import { directSync, type DirectSyncConfig } from '../lib/directSync';
import {
  upsertRawIssues, getRawSince, setBoardLastSync,
  readUnclassifiedIssues, updateIssueTallas,
  loadCoreIssues, loadCoreTransitions, loadCoreMembers, listBoardSync,
} from '../lib/db';
import { writeSnapshots } from '../lib/snapshots';
import type { JiraHttp } from '@teammetrics/core/jira';
import type { GenerateFn } from '@teammetrics/core/classify';
import type { CoreIssueWorkload, CoreTransition, CoreMember } from '@teammetrics/core/types';

const NOW = new Date('2026-07-01T00:00:00Z');
const dbStub = { __marker: 'db' } as any;

const boardCfg = { baseUrl: 'https://x.atlassian.net', email: 'e@t.com', apiToken: 'tok', projectKey: 'OPS', boardId: 7 };

function jiraApiIssue(key: string, summary: string) {
  return {
    key,
    fields: {
      summary,
      description: null,
      status: { name: 'To Do' },
      assignee: null,
      created: '2026-06-01T00:00:00Z',
      updated: '2026-06-01T00:00:00Z',
    },
    changelog: { histories: [] },
  };
}

const coreIssues: CoreIssueWorkload[] = [
  { id: 'A', title: 'Issue A', status: 'To Do', assignee_id: null, talla: null, created_at: '2026-06-01T00:00:00Z', last_transition_at: null,
    requester: null, priority: null, boards: [] },
];
const coreTransitions: CoreTransition[] = [];
const coreMembers: CoreMember[] = [];

function baseConfig(overrides: Partial<DirectSyncConfig> = {}): DirectSyncConfig {
  return { boards: [boardCfg], geminiKey: 'gkey', filters: {}, ...overrides };
}

function setupDbMocks() {
  (getRawSince as jest.Mock).mockResolvedValue('2026-06-01T00:00:00Z');
  (readUnclassifiedIssues as jest.Mock).mockResolvedValue([{ id: 'A', title: 'Issue A', description: 'desc' }]);
  (loadCoreIssues as jest.Mock).mockResolvedValue(coreIssues);
  (loadCoreTransitions as jest.Mock).mockResolvedValue(coreTransitions);
  (loadCoreMembers as jest.Mock).mockResolvedValue(coreMembers);
}

beforeEach(() => {
  jest.clearAllMocks();
  setupDbMocks();
});

describe('directSync', () => {
  it('fetches per board using `since` from getRawSince, upserts raw, classifies pending, computes + writes a bundle, and reports success', async () => {
    const http: JiraHttp = jest.fn(async (req: any) => {
      if (req.url.endsWith('/board/7')) return { id: 7, name: 'Black Team Infra' };
      return { issues: [jiraApiIssue('A', 'Issue A')], total: 1 };
    }) as any;
    const fakeGenerate: GenerateFn = jest.fn().mockResolvedValue('[{"talla":"M","confidence":0.9}]');
    const makeGen = jest.fn().mockReturnValue(fakeGenerate);

    const result = await directSync(dbStub, baseConfig(), { http, makeGen, now: NOW });

    expect(result.success).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.syncedAt).toBe(NOW.toISOString());

    // fetched with `since` from getRawSince
    expect(getRawSince).toHaveBeenCalledWith(dbStub, 7);
    expect(http).toHaveBeenCalledTimes(2);
    const [req] = (http as jest.Mock).mock.calls[0];
    expect(req.url).toContain('/board/7/issue');
    expect(req.params.jql).toContain('updated >= "2026-06-01 00:00"');

    // upserted raw + advanced the board watermark, carrying the board name fetched from Jira
    expect(upsertRawIssues).toHaveBeenCalledWith(
      dbStub,
      expect.arrayContaining([expect.objectContaining({ id: 'A', title: 'Issue A' })]),
    );
    expect(setBoardLastSync).toHaveBeenCalledWith(dbStub, 7, NOW.toISOString(), 'Black Team Infra');

    // classified the pending issue
    expect(readUnclassifiedIssues).toHaveBeenCalledWith(dbStub);
    expect(makeGen).toHaveBeenCalledWith('gkey');
    expect(fakeGenerate).toHaveBeenCalled();
    expect(updateIssueTallas).toHaveBeenCalledWith(dbStub, expect.any(Map));
    const tallaMap = (updateIssueTallas as jest.Mock).mock.calls[0][1] as Map<string, any>;
    expect(tallaMap.get('A')).toEqual(expect.objectContaining({ talla: 'M', confidence: 0.9 }));

    // computed a bundle from loadCore* and wrote it
    expect(loadCoreIssues).toHaveBeenCalledWith(dbStub);
    expect(loadCoreTransitions).toHaveBeenCalledWith(dbStub);
    expect(loadCoreMembers).toHaveBeenCalledWith(dbStub);
    expect(writeSnapshots).toHaveBeenCalledTimes(1);
    const [writtenDb, bundle, writtenSyncedAt] = (writeSnapshots as jest.Mock).mock.calls[0];
    expect(writtenDb).toBe(dbStub);
    expect(writtenSyncedAt).toBe(NOW.toISOString());
    expect(bundle.kpi).toBeDefined();
    expect(Array.isArray(bundle.issues)).toBe(true);

    expect(result.okCount).toBeGreaterThan(0);
    expect(result.failCount).toBe(0);
  });

  it('corta la clasificación tras un lote sin resultados (cuota Gemini agotada) y no cuelga el sync', async () => {
    // 40 pendientes => 2 lotes de 20
    (readUnclassifiedIssues as jest.Mock).mockResolvedValue(
      Array.from({ length: 40 }, (_, i) => ({ id: `I${i}`, title: 't', description: 'd' })),
    );
    const http: JiraHttp = jest.fn().mockResolvedValue({ issues: [], total: 0 });
    // 'not-json' => parseBatchResponse cae en fallbackMap (todos confidence 0)
    const fakeGenerate: GenerateFn = jest.fn().mockResolvedValue('not-json');
    const makeGen = jest.fn().mockReturnValue(fakeGenerate);

    const result = await directSync(dbStub, baseConfig(), { http, makeGen, now: NOW });

    // cortó tras el primer lote fallback: sólo 1 llamada a generate (no 2)
    expect(fakeGenerate).toHaveBeenCalledTimes(1);
    // el sync igual completa: recomputa y escribe snapshots
    expect(writeSnapshots).toHaveBeenCalledTimes(1);
    expect(result.errors.some(e => e.endpoint.startsWith('classify:batch'))).toBe(true);
  });

  it('keeps going and reports the error when a board fetch fails, still classifying + computing + writing', async () => {
    const http: JiraHttp = jest.fn().mockRejectedValue(new Error('boom'));
    const fakeGenerate: GenerateFn = jest.fn().mockResolvedValue('[{"talla":"M","confidence":0.9}]');
    const makeGen = jest.fn().mockReturnValue(fakeGenerate);

    const result = await directSync(dbStub, baseConfig(), { http, makeGen, now: NOW });

    expect(result.success).toBe(false);
    expect(result.errors).toEqual([{ endpoint: 'jira:board:7', message: 'boom' }]);
    expect(result.failCount).toBeGreaterThan(0);

    expect(upsertRawIssues).not.toHaveBeenCalled();
    expect(setBoardLastSync).not.toHaveBeenCalled();

    // best-effort: classify + compute + write still happen
    expect(updateIssueTallas).toHaveBeenCalled();
    expect(writeSnapshots).toHaveBeenCalledTimes(1);
  });

  it('keeps going and reports the error when a classify batch fails, still writing a bundle', async () => {
    const http: JiraHttp = jest.fn().mockResolvedValue({ issues: [], total: 0 });
    const fakeGenerate: GenerateFn = jest.fn().mockRejectedValue(new Error('gemini down'));
    const makeGen = jest.fn().mockReturnValue(fakeGenerate);

    const result = await directSync(dbStub, baseConfig(), { http, makeGen, now: NOW });

    // classifyTallaBatch swallows generate() failures into a fallback map (all-null tallas)
    // rather than throwing, so the classify step itself succeeds but classifies nothing.
    expect(updateIssueTallas).toHaveBeenCalledWith(dbStub, expect.any(Map));
    const tallaMap = (updateIssueTallas as jest.Mock).mock.calls[0][1] as Map<string, any>;
    expect(tallaMap.get('A')).toEqual(expect.objectContaining({ talla: null }));

    expect(writeSnapshots).toHaveBeenCalledTimes(1);
    expect(result.errors.filter(e => e.endpoint.startsWith('jira:'))).toEqual([]);
  });

  it('classifies pending issues in batches of 20', async () => {
    const pending = Array.from({ length: 25 }, (_, i) => ({ id: `I${i}`, title: `T${i}`, description: '' }));
    (readUnclassifiedIssues as jest.Mock).mockResolvedValue(pending);
    const http: JiraHttp = jest.fn().mockResolvedValue({ issues: [], total: 0 });
    // Respuesta que clasifica al menos un issue (confidence > 0) para que el lote NO
    // dispare el corte por "sin clasificaciones" y se procesen ambos lotes.
    const fakeGenerate: GenerateFn = jest.fn().mockResolvedValue('[{"talla":"M","confidence":0.9}]');
    const makeGen = jest.fn().mockReturnValue(fakeGenerate);

    await directSync(dbStub, baseConfig(), { http, makeGen, now: NOW });

    expect(fakeGenerate).toHaveBeenCalledTimes(2);
    expect(updateIssueTallas).toHaveBeenCalledTimes(2);
  });

  it('reporta progreso por board via deps.onProgress', async () => {
    (getRawSince as jest.Mock).mockResolvedValue(undefined);
    (readUnclassifiedIssues as jest.Mock).mockResolvedValue([]);
    (loadCoreIssues as jest.Mock).mockResolvedValue([]);
    (loadCoreTransitions as jest.Mock).mockResolvedValue([]);
    (loadCoreMembers as jest.Mock).mockResolvedValue([]);
    const http = jest.fn().mockResolvedValue({ issues: [], total: 0 });
    const onProgress = jest.fn();
    const config: DirectSyncConfig = { boards: [boardCfg], geminiKey: 'gk', filters: {} };
    await directSync(dbStub, config, { http, now: NOW, onProgress });
    expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ label: expect.stringContaining('board') }));
  });

  it('el nombre de board traído de Jira via listBoardSync termina en el WorkloadResult del bundle', async () => {
    (listBoardSync as jest.Mock).mockResolvedValue([{ id: 7, name: 'Black Team Infra' }]);
    const http: JiraHttp = jest.fn().mockResolvedValue({ issues: [], total: 0 });
    const fakeGenerate: GenerateFn = jest.fn().mockResolvedValue('[{"talla":"M","confidence":0.9}]');
    const makeGen = jest.fn().mockReturnValue(fakeGenerate);

    await directSync(dbStub, baseConfig(), { http, makeGen, now: NOW });

    const [, bundle] = (writeSnapshots as jest.Mock).mock.calls[0];
    const squad = bundle.workload.squads.find((s: any) => s.board_id === 7);
    expect(squad).toEqual(expect.objectContaining({ board_id: 7, name: 'Black Team Infra' }));
  });

  it('si listBoardSync devuelve name null el squad cae en "Board {id}" sin romper el sync', async () => {
    (listBoardSync as jest.Mock).mockResolvedValue([{ id: 7, name: null }]);
    const http: JiraHttp = jest.fn().mockResolvedValue({ issues: [], total: 0 });
    const fakeGenerate: GenerateFn = jest.fn().mockResolvedValue('[{"talla":"M","confidence":0.9}]');
    const makeGen = jest.fn().mockReturnValue(fakeGenerate);

    const result = await directSync(dbStub, baseConfig(), { http, makeGen, now: NOW });

    expect(result.success).toBe(true);
    const [, bundle] = (writeSnapshots as jest.Mock).mock.calls[0];
    const squad = bundle.workload.squads.find((s: any) => s.board_id === 7);
    expect(squad).toEqual(expect.objectContaining({ board_id: 7, name: 'Board 7' }));
  });
});
