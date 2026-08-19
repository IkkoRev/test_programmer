import express from 'express';
import { config } from './config';
import mentionsRouter from './routes/mentions';

const app = express();

// --- Middleware ---
// Parse JSON bodies dengan limit yang cukup besar untuk payload bulk ingest
app.use(express.json({ limit: '10mb' }));

// Logging request (ringan, tidak butuh dependensi eksternal)
app.use((req, _res, next) => {
  const start = Date.now();
  const originalEnd = _res.end;
  _res.end = function (...args: any[]) {
    const duration = Date.now() - start;
    console.log(`${req.method} ${req.originalUrl} ${_res.statusCode} ${duration}ms`);
    return originalEnd.apply(this, args);
  } as any;
  next();
});

// --- Routes ---
app.use('/', mentionsRouter);

// Health check endpoint
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// --- Error handling ---
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: config.nodeEnv === 'development' ? err.message : undefined,
  });
});

// --- Start server ---
if (require.main === module) {
  app.listen(config.port, () => {
    console.log(`\n🚀 Media Monitoring API berjalan di http://localhost:${config.port}`);
    console.log(`   Environment: ${config.nodeEnv}`);
    console.log(`   Database: ${config.database.path}\n`);
  });
}

export default app;
