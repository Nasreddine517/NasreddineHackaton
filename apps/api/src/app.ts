import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import { ZodError } from 'zod';
import { BusinessError } from '../../../packages/core/src/domain/pricing.js';
import { registerCommerce, type MerchantConfig } from './commerce.js';
import type { createConnections } from '../../../packages/core/src/connections.js';
import type { AgentModels } from '../../../packages/core/src/agents/models.js';
import { registerChat } from './chat.js';

type Dependencies = ReturnType<typeof createConnections>;

export async function createApp(
  connections: Dependencies,
  logLevel = 'info',
  merchant: MerchantConfig = { MERCHANT_EMAIL: '', MERCHANT_PASSWORD: '', COOKIE_SECURE: false },
  models?: AgentModels,
) {
  const app = Fastify({
    logger: {
      level: logLevel,
      redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
    },
    bodyLimit: 1024 * 1024,
    requestTimeout: 30000,
  });
  await app.register(websocket);
  const auth = await registerCommerce(app, connections, merchant);
  if (models) await registerChat(app, connections, auth, models);
  app.get('/api/health/live', async () => ({ status: 'ok', service: 'kenza-api' }));
  app.get('/api/health/ready', async (_request, reply) => {
    const [db, redis, heartbeat] = await Promise.allSettled([
      connections.db.query('SELECT 1'),
      connections.redis.ping(),
      connections.redis.get('kenza:worker:heartbeat'),
    ]);
    const postgresReady = db.status === 'fulfilled';
    const redisReady = redis.status === 'fulfilled' && redis.value === 'PONG';
    const workerReady =
      heartbeat.status === 'fulfilled' &&
      heartbeat.value !== null &&
      Date.now() - Number(heartbeat.value) < 45000;
    if (!postgresReady || !redisReady) reply.code(503);
    return {
      status: postgresReady && redisReady ? 'ok' : 'unavailable',
      services: { postgres: postgresReady, redis: redisReady, worker: workerReady },
    };
  });
  app.get('/api/system', async () => ({
    phase: models ? 'agents' : 'checkout',
    chatEnabled: Boolean(models),
    merchantEnabled: Boolean(merchant.MERCHANT_EMAIL && merchant.MERCHANT_PASSWORD),
    checkoutEnabled: true,
    followupEnabled: false,
  }));
  app.get('/api/events', { websocket: true }, (socket) => {
    socket.send(JSON.stringify({ type: 'connected', service: 'kenza-api' }));
    socket.on('message', () => {
      socket.send(
        JSON.stringify({
          type: 'unavailable',
          message: 'Ouvrez un profil client pour accéder au canal de conversation authentifié.',
        }),
      );
    });
  });
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof BusinessError)
      return reply.code(409).send({ error: error.code, message: error.message });
    if (error instanceof ZodError)
      return reply.code(400).send({
        error: 'INVALID_REQUEST',
        message: 'Vérifiez les champs saisis et le mode de paiement.',
      });
    const failure =
      error instanceof Error
        ? (error as Error & { code?: string; statusCode?: number })
        : undefined;
    request.log.warn({ errorCode: failure?.code, requestId: request.id }, 'Request failed');
    const code =
      typeof failure?.statusCode === 'number' &&
      failure.statusCode >= 400 &&
      failure.statusCode < 500
        ? failure.statusCode
        : 500;
    reply.code(code).send({
      error: code === 500 ? 'SERVICE_ERROR' : 'INVALID_REQUEST',
      message: 'La requête ne peut pas être traitée.',
      requestId: request.id,
    });
  });
  app.addHook('onClose', async () => {
    await connections.close();
  });
  return app;
}
