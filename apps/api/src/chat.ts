import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { createConnections } from '../../../packages/core/src/connections.js';
import type { registerCommerce } from './commerce.js';
import {
  createConversationService,
  conversationHistory,
  withConversationLock,
} from '../../../packages/core/src/agents/conversation.js';
import type { AgentModels } from '../../../packages/core/src/agents/models.js';

type Socket = { readyState: number; send(data: string): void; close(): void };
export async function registerChat(
  app: FastifyInstance,
  { db }: ReturnType<typeof createConnections>,
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
    for (const group of sockets.values()) for (const socket of group) socket.close();
  });

  app.get('/api/merchant/conversations', async (request) => {
    await auth.session(request, 'merchant');
    return {
      conversations: (
        await db.query(`SELECT c.customer_id,c.mode,c.updated_at,p.name,
      (SELECT content FROM chat_messages m WHERE m.customer_id=c.customer_id ORDER BY id DESC LIMIT 1) AS last_message,
      (SELECT count(*)::int FROM escalations e WHERE e.customer_id=c.customer_id AND status='open') AS open_escalations
      FROM conversations c JOIN customers p ON p.id=c.customer_id ORDER BY c.updated_at DESC LIMIT 100`)
      ).rows,
    };
  });
  app.get('/api/merchant/conversations/:id', async (request) => {
    await auth.session(request, 'merchant');
    const { id } = z.object({ id: z.string().max(80) }).parse(request.params);
    return {
      ...(await conversationHistory(db, id)),
      events: (
        await db.query(
          'SELECT agent,action,details,created_at FROM agent_events WHERE customer_id=$1 ORDER BY id DESC LIMIT 100',
          [id],
        )
      ).rows,
      escalations: (
        await db.query(
          'SELECT id,reason,status,context,created_at FROM escalations WHERE customer_id=$1 ORDER BY created_at DESC LIMIT 20',
          [id],
        )
      ).rows,
    };
  });
  app.post('/api/merchant/conversations/:id/control', async (request) => {
    await auth.session(request, 'merchant');
    const { id } = z.object({ id: z.string().max(80) }).parse(request.params);
    const { mode } = z
      .object({ mode: z.enum(['auto', 'human']) })
      .strict()
      .parse(request.body);
    return withConversationLock(db, id, async () => {
      await db.query('UPDATE conversations SET mode=$2,updated_at=now() WHERE customer_id=$1', [
        id,
        mode,
      ]);
      if (mode === 'auto')
        await db.query(
          "UPDATE escalations SET status='resolved' WHERE customer_id=$1 AND status='open'",
          [id],
        );
      await db.query(
        "INSERT INTO agent_events(customer_id,agent,action,details) VALUES ($1,'merchant','mode_changed',$2)",
        [id, JSON.stringify({ mode })],
      );
      notify(id, { type: 'conversation.updated' });
      return { mode };
    });
  });
  app.post('/api/merchant/conversations/:id/messages', async (request) => {
    await auth.session(request, 'merchant');
    const { id } = z.object({ id: z.string().max(80) }).parse(request.params);
    const { message } = z
      .object({ message: z.string().trim().min(1).max(2000) })
      .strict()
      .parse(request.body);
    return withConversationLock(db, id, async () => {
      await db.query(
        "UPDATE conversations SET mode='human',updated_at=now() WHERE customer_id=$1",
        [id],
      );
      await db.query(
        "INSERT INTO chat_messages(customer_id,role,content) VALUES ($1,'merchant',$2)",
        [id, message],
      );
      notify(id, { type: 'conversation.updated' });
      return conversationHistory(db, id);
    });
  });
  return service;
}
