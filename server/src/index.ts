import 'dotenv/config';
import app from './app';
import { checkDatabaseHealth } from './lib/prisma';
import { checkRedisHealth } from './lib/redis';
import { checkQueuesHealth, wireDlqForwarding, QUEUE_NAMES } from './queues';

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 4000;

async function startupHealthCheck(): Promise<void> {
  console.log('Running startup health checks...');

  const database = await checkDatabaseHealth();
  console.log(`  Database:   ${database ? '✓' : '✗'}`);

  const redis = await checkRedisHealth();
  console.log(`  Redis:      ${redis ? '✓' : '✗'}`);

  const queues = await checkQueuesHealth();
  for (const name of QUEUE_NAMES) {
    console.log(`  Queue [${name}]: ${queues[name] ? '✓' : '✗'}`);
  }

  if (!database || !redis || Object.values(queues).some((v) => !v)) {
    console.error('\n⚠  One or more services are unavailable. Server starting in degraded mode.');
  } else {
    console.log('\n✓ All services healthy.');
  }
}

async function main(): Promise<void> {
  await startupHealthCheck();
  wireDlqForwarding();

  app.listen(PORT, () => {
    console.log(`\nOutreachOS API running on http://localhost:${PORT}`);
    console.log(`Health check: http://localhost:${PORT}/api/health`);
  });
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
