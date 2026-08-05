import dotenv from 'dotenv';
import path from 'path';
// Look for .env in server/ first, then parent directory
dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
import express from 'express';
import cors from 'cors';
import { initDb } from './db/index';
import issuesRouter from './routes/issues';
import metricsRouter from './routes/metrics';
import teamRouter from './routes/team';
import syncRouter from './routes/sync';
import tallasRouter from './routes/tallas';
import { startSyncJob } from './services/sync';

export const app = express();
app.use(cors());
app.use(express.json());

app.use('/api/issues', issuesRouter);
app.use('/api/metrics', metricsRouter);
app.use('/api/team', teamRouter);
app.use('/api/sync', syncRouter);
app.use('/api/tallas', tallasRouter);

app.get('/api/config', (_req, res) => {
  res.json({ jiraBaseUrl: process.env.JIRA_BASE_URL ?? '' });
});

// Global error handler — catches any error propagated via next(err)
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('API error:', err.message);
  res.status(500).json({ error: err.message });
});

if (require.main === module) {
  initDb();
  startSyncJob();
  const PORT = process.env.PORT || 3001;
  app.listen(PORT, () => console.log(`TeamMetrics server running on :${PORT}`));
}
