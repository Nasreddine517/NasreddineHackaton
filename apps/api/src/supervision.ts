import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import type { registerCommerce } from './commerce.js';
import {
  conversationHistory,
  type Notify,
} from '../../../packages/core/src/agents/conversation.js';
import { getCart } from '../../../packages/core/src/domain/checkout.js';
import { followupReport } from '../../../packages/core/src/domain/followups.js';
import {
  merchantMetrics,
  updateSupervision,
} from '../../../packages/core/src/domain/supervision.js';

export async function registerSupervision(
  app: FastifyInstance,
  db: pg.Pool,
  auth: Awaited<ReturnType<typeof registerCommerce>>,
  notify: Notify = () => {},
) {
  const params = z.object({ id: z.string().min(1).max(80) });
  app.get('/api/merchant/followups', async (request) => {
    await auth.session(request, 'merchant');
    return followupReport(db);
  });
  app.get('/api/merchant/metrics', async (request) => {
    await auth.session(request, 'merchant');
    return merchantMetrics(db);
  });
  app.get('/api/merchant/conversations', async (request) => {
    await auth.session(request, 'merchant');
    const { filter } = z
      .object({ filter: z.enum(['all', 'escalated', 'human']).default('all') })
      .parse(request.query);
    return {
      conversations: (
        await db.query(
          `SELECT c.customer_id,c.mode,c.updated_at,p.name,
      (SELECT content FROM chat_messages m WHERE m.customer_id=c.customer_id ORDER BY id DESC LIMIT 1) AS last_message,
      (SELECT count(*)::int FROM escalations e WHERE e.customer_id=c.customer_id AND status='open') AS open_escalations
      FROM conversations c JOIN customers p ON p.id=c.customer_id
      WHERE $1='all' OR ($1='human' AND c.mode='human') OR ($1='escalated' AND EXISTS (
        SELECT 1 FROM escalations e WHERE e.customer_id=c.customer_id AND e.status='open'))
      ORDER BY c.updated_at DESC LIMIT 100`,
          [filter],
        )
      ).rows,
    };
  });
  app.get('/api/merchant/conversations/:id', async (request) => {
    await auth.session(request, 'merchant');
    const { id } = params.parse(request.params);
    const customer = (
      await db.query(
        `SELECT p.id,p.name,p.city,p.preferred_language,c.followup_refused
      FROM customers p JOIN conversations c ON c.customer_id=p.id WHERE p.id=$1`,
        [id],
      )
    ).rows[0];
    if (!customer) throw Object.assign(new Error('Conversation not found'), { statusCode: 404 });
    return {
      ...(await conversationHistory(db, id)),
      customer,
      cart: await getCart(db, id),
      orders: (
        await db.query(
          "SELECT id,status,total_centimes,created_at FROM orders WHERE customer_id=$1 AND source='kenza' ORDER BY created_at DESC LIMIT 10",
          [id],
        )
      ).rows,
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
    const { id } = params.parse(request.params);
    const action = z
      .object({ mode: z.enum(['auto', 'human']) })
      .strict()
      .parse(request.body);
    await updateSupervision(db, id, action);
    notify(id, { type: 'conversation.updated' });
    return action;
  });
  app.post('/api/merchant/conversations/:id/resolve', async (request) => {
    await auth.session(request, 'merchant');
    const { id } = params.parse(request.params);
    z.object({}).strict().parse(request.body);
    await updateSupervision(db, id, { resolve: true });
    notify(id, { type: 'conversation.updated' });
    return { resolved: true };
  });
  app.post('/api/merchant/conversations/:id/messages', async (request) => {
    await auth.session(request, 'merchant');
    const { id } = params.parse(request.params);
    const action = z
      .object({ id: z.string().uuid(), message: z.string().trim().min(1).max(2000) })
      .strict()
      .parse(request.body);
    await updateSupervision(db, id, action);
    notify(id, { type: 'conversation.updated' });
    return conversationHistory(db, id);
  });
}
