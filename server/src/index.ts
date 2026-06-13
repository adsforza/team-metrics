import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { initDb } from './db/index';
import issuesRouter from './routes/issues';
import metricsRouter from './routes/metrics';
import teamRouter from './routes/team';
import syncRouter from './routes/sync';
import { startSyncJob } from './services/sync';

export const app = express();
app.use(cors());
app.use(express.json());

app.use('/api/issues', issuesRouter);
app.use('/api/metrics', metricsRouter);
app.use('/api/team', teamRouter);
app.use('/api/sync', syncRouter);

if (require.main === module) {
  initDb();
  startSyncJob();
  const PORT = process.env.PORT || 3001;
  app.listen(PORT, () => console.log(`TeamMetrics server running on :${PORT}`));
}
