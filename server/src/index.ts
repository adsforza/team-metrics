import 'dotenv/config';
import express from 'express';
import cors from 'cors';

export const app = express();
app.use(cors());
app.use(express.json());

// Routes will be mounted in future tasks:
// app.use('/api/issues', issuesRouter);
// app.use('/api/metrics', metricsRouter);
// app.use('/api/team', teamRouter);
// app.use('/api/sync', syncRouter);

if (require.main === module) {
  const PORT = process.env.PORT || 3001;
  app.listen(PORT, () => console.log(`TeamMetrics server running on :${PORT}`));
}
