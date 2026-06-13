import cron from 'node-cron';
import Database from 'better-sqlite3';
import { getDb } from '../db/index';
import { createJiraClient } from './jira';
import { classifyTalla } from './claude';

export interface SyncResult {
  synced_count: number;
  classified_count: number;
}

export async function runSync(db: Database.Database): Promise<SyncResult> {
  const startedAt = new Date().toISOString();
  const logStmt = db.prepare(
    `INSERT INTO sync_log (started_at, synced_count, classified_count) VALUES (?, 0, 0)`
  );
  const logId = Number(logStmt.run(startedAt).lastInsertRowid);

  let synced_count = 0;
  let classified_count = 0;

  try {
    const lastSync = (db.prepare(`SELECT MAX(finished_at) as last FROM sync_log WHERE error IS NULL`).get() as any)?.last;
    const client = createJiraClient();
    const issues = await client.fetchIssues(lastSync ?? undefined);

    const now = new Date().toISOString();

    for (const issue of issues) {
      // Upsert team member
      if (issue.assignee) {
        db.prepare(`
          INSERT INTO team_members (id, display_name, email, avatar_url)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET display_name=excluded.display_name, email=excluded.email, avatar_url=excluded.avatar_url
        `).run(issue.assignee.id, issue.assignee.display_name, issue.assignee.email, issue.assignee.avatar_url);
      }

      // Determine talla
      const existing = db.prepare(`SELECT talla, description FROM issues WHERE id = ?`).get(issue.id) as any;
      const needsClassification = !existing || existing.description !== issue.description;
      let talla = existing?.talla ?? null;
      let talla_confidence = null;

      if (needsClassification) {
        const result = await classifyTalla(issue.title, issue.description);
        talla = result.talla;
        talla_confidence = result.confidence;
        classified_count++;
      }

      // Compute last_transition_at
      const lastTransition = issue.transitions.length > 0
        ? issue.transitions.reduce((a, b) => a.transitioned_at > b.transitioned_at ? a : b)
        : null;

      // Upsert issue
      db.prepare(`
        INSERT INTO issues (id, title, description, status, assignee_id, talla, talla_confidence, created_at, updated_at, synced_at, last_transition_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          title=excluded.title, description=excluded.description, status=excluded.status,
          assignee_id=excluded.assignee_id, talla=excluded.talla, talla_confidence=excluded.talla_confidence,
          updated_at=excluded.updated_at, synced_at=excluded.synced_at, last_transition_at=excluded.last_transition_at
      `).run(
        issue.id, issue.title, issue.description, issue.status,
        issue.assignee?.id ?? null, talla, talla_confidence,
        issue.created_at, issue.updated_at, now, lastTransition?.transitioned_at ?? null
      );

      // Upsert transitions (insert only new ones by transitioned_at)
      for (const t of issue.transitions) {
        const exists = db.prepare(
          `SELECT id FROM transitions WHERE issue_id = ? AND to_status = ? AND transitioned_at = ?`
        ).get(issue.id, t.to_status, t.transitioned_at);
        if (!exists) {
          db.prepare(`INSERT INTO transitions (issue_id, from_status, to_status, transitioned_at) VALUES (?, ?, ?, ?)`)
            .run(issue.id, t.from_status, t.to_status, t.transitioned_at);
        }
      }

      synced_count++;
    }

    db.prepare(`UPDATE sync_log SET finished_at=?, synced_count=?, classified_count=? WHERE id=?`)
      .run(new Date().toISOString(), synced_count, classified_count, logId);

  } catch (err: any) {
    db.prepare(`UPDATE sync_log SET finished_at=?, error=? WHERE id=?`)
      .run(new Date().toISOString(), err.message, logId);
    throw err;
  }

  return { synced_count, classified_count };
}

export function startSyncJob(): void {
  const intervalMinutes = Number(process.env.SYNC_INTERVAL_MINUTES ?? 30);
  const cronExpr = `*/${intervalMinutes} * * * *`;
  console.log(`Sync job scheduled: every ${intervalMinutes} minutes`);
  cron.schedule(cronExpr, () => {
    runSync(getDb()).catch(err => console.error('Sync failed:', err));
  });
}
