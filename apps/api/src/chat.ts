import type { FastifyInstance } from 'fastify';
import type { createConnections } from '../../../packages/core/src/connections.js';
import type { registerCommerce } from './commerce.js';
import {
  createConversationService,
  withConversationLock,
} from '../../../packages/core/src/agents/conversation.js';
import { registerSupervision } from './supervision.js';
import type { AgentModels } from '../../../packages/core/src/agents/models.js';
import { FOLLOWUP_CHANNEL } from '../../../packages/core/src/domain/followups.js';

type Socket = { readyState: number; send(data: string): void; close(): void };
export async function registerChat(
  app: FastifyInstance,
  { db, redis }: ReturnType<typeof createConnections>,
  auth: Awaited<ReturnType<typeof registerCommerce>>,
  models: AgentModels,
) {
  const sockets = new Map<string, Set<Socket>>();
  function notify(customerId: string, event: Record<string, unknown>) {
    for (const socket of sockets.get(customerId) ?? []) {
      if (socket.readyState === 1) socket.send(JSON.stringify(event));
    }
  }
  const service = await createConversationService(db, models, notify);
  const subscriber = redis.duplicate();
  subscriber.on('error', () => {});
  subscriber.on('message', (_channel, message) => {
    try {
      const value = JSON.parse(message);
      if (typeof value.customerId === 'string')
        notify(value.customerId, { type: 'conversation.updated' });
    } catch {}
  });
  await subscriber.subscribe(FOLLOWUP_CHANNEL);
  app.post('/api/client/followups/refuse', async (request) => {
    const id = await auth.session(request, 'client');
    await withConversationLock(db, id, async (connection) => {
      await connection.query(
        `INSERT INTO conversations(customer_id,followup_refused) VALUES ($1,true)
        ON CONFLICT(customer_id) DO UPDATE SET followup_refused=true`,
        [id],
      );
    });
    notify(id, { type: 'conversation.updated' });
    return { refused: true };
  });
  app.get('/api/client/conversation', async (request) =>
    service.history(await auth.session(request, 'client')),
  );
  app.post('/api/client/messages', async (request) => {
    const id = await auth.session(request, 'client');
    await auth.rateLimit(`rate:chat:${id}`, 30);
    return service.send(id, request.body);
  });
  app.get(
    '/api/client/events',
    {
      websocket: true,
      preValidation: async (request) => {
        const origin = request.headers.origin;
        if (
          !origin ||
          new URL(origin).host !== request.headers.host ||
          request.headers['sec-fetch-site'] === 'cross-site'
        )
          throw Object.assign(new Error('Denied'), { statusCode: 403 });
        await auth.session(request, 'client');
      },
    },
    (socket, request) => {
      let customerId: string | undefined,
        closed = false;
      socket.on('error', () => {});
      socket.on('close', () => {
        closed = true;
        if (customerId) {
          sockets.get(customerId)?.delete(socket);
          if (!sockets.get(customerId)?.size) sockets.delete(customerId);
        }
      });
      void auth
        .session(request, 'client')
        .then((id) => {
          if (closed) return;
          customerId = id;
          const group = sockets.get(id) ?? new Set<Socket>();
          group.add(socket);
          sockets.set(id, group);
          socket.send(JSON.stringify({ type: 'connected' }));
        })
        .catch(() => socket.close());
      // Revalidate the cookie periodically, including after a profile switch or expiry.
      const check = setInterval(() => {
        void auth.session(request, 'client').catch(() => socket.close());
      }, 30_000);
      socket.on('close', () => clearInterval(check));
    },
  );
  app.addHook('onClose', async () => {
    subscriber.disconnect();
    for (const group of sockets.values()) for (const socket of group) socket.close();
  });

  await registerSupervision(app, db, auth, notify);
  return service;
}
