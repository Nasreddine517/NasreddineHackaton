import { createHash, randomUUID } from 'node:crypto';
import type pg from 'pg';
import { getCart } from './checkout.js';
import { withConversationLock } from '../agents/conversation.js';
import { BusinessError } from './pricing.js';

export const FOLLOWUP_CHANNEL = 'kenza:conversation:updates';
export const FOLLOWUP_QUEUE = 'kenza-followups';
export type Followup = {
  id: string;
  customer_id: string;
  last_message_id: string;
  due_at: Date;
  variant: 'A' | 'B';
  status: string;
};
export function variantFor(customerId: string): 'A' | 'B' {
  return createHash('sha256').update(`abandon-v1:${customerId}`).digest()[0]! % 2 ? 'B' : 'A';
}

// PostgreSQL is the durable outbox. BullMQ may be unavailable here; the worker
// reconciles this table after every restart instead of losing delayed work.
export async function reconcileFollowups(db: pg.Pool, delayMs: number) {
  if (!Number.isSafeInteger(delayMs) || delayMs <= 0) throw new Error('Invalid followup delay');
  await db.query(`UPDATE followups f SET status='cancelled',reason='ineligible'
    WHERE f.status='pending' AND (
      NOT EXISTS (SELECT 1 FROM conversations c WHERE c.customer_id=f.customer_id AND c.mode='auto' AND NOT c.followup_refused)
      OR EXISTS (SELECT 1 FROM chat_messages m WHERE m.customer_id=f.customer_id AND m.role='user' AND m.id>f.last_message_id)
      OR NOT EXISTS (SELECT 1 FROM cart_items i WHERE i.customer_id=f.customer_id)
      OR EXISTS (SELECT 1 FROM orders o JOIN chat_messages m ON m.id=f.last_message_id
        WHERE o.customer_id=f.customer_id AND o.source='kenza' AND o.created_at>=m.created_at))`);
  const candidates = (
    await db.query(`SELECT c.customer_id,m.id::text AS message_id,m.created_at
    FROM conversations c JOIN LATERAL (
      SELECT id,created_at,turn_id FROM chat_messages WHERE customer_id=c.customer_id AND role='user' ORDER BY id DESC LIMIT 1
    ) m ON true JOIN chat_turns t ON t.id=m.turn_id
    WHERE c.mode='auto' AND NOT c.followup_refused AND t.status='completed'
    AND EXISTS (SELECT 1 FROM cart_items i WHERE i.customer_id=c.customer_id)
    AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.customer_id=c.customer_id AND o.source='kenza' AND o.created_at>=m.created_at)
    AND NOT EXISTS (SELECT 1 FROM followups f WHERE f.customer_id=c.customer_id AND f.last_message_id=m.id)
    AND NOT EXISTS (SELECT 1 FROM agent_events e WHERE e.customer_id=c.customer_id AND e.created_at>=m.created_at
      AND (e.action='transferred' OR (e.agent='merchant' AND (e.action='message_sent' OR e.details->>'mode'='human'))))
    ORDER BY m.created_at LIMIT 200`)
  ).rows;
  for (const row of candidates) {
    try {
      await withConversationLock(db, row.customer_id, async (connection) => {
        await connection.query(
          'INSERT INTO followup_assignments(customer_id,variant) VALUES ($1,$2) ON CONFLICT DO NOTHING',
          [row.customer_id, variantFor(row.customer_id)],
        );
        // Conditional insertion handles a message/handoff/order arriving during the scan.
        await connection.query(
          `INSERT INTO followups(id,customer_id,last_message_id,due_at,variant)
      SELECT $1,c.customer_id,m.id,m.created_at+($3::bigint * interval '1 millisecond'),a.variant
      FROM conversations c JOIN chat_messages m ON m.id=$2::bigint
      JOIN followup_assignments a ON a.customer_id=c.customer_id
      WHERE c.customer_id=m.customer_id AND c.mode='auto' AND NOT c.followup_refused
      AND NOT EXISTS (SELECT 1 FROM chat_messages newer WHERE newer.customer_id=c.customer_id AND newer.role='user' AND newer.id>m.id)
      AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.customer_id=c.customer_id AND o.source='kenza' AND o.created_at>=m.created_at)
      AND NOT EXISTS (SELECT 1 FROM agent_events e WHERE e.customer_id=c.customer_id AND e.created_at>=m.created_at
        AND (e.action='transferred' OR (e.agent='merchant' AND (e.action='message_sent' OR e.details->>'mode'='human'))))
      ON CONFLICT(customer_id,last_message_id) DO NOTHING`,
          [randomUUID(), row.message_id, delayMs],
        );
      });
    } catch (error) {
      // A running client turn wins; reconsider on the next outbox scan.
      if (!(error instanceof BusinessError) || error.code !== 'CONVERSATION_BUSY') throw error;
    }
  }
  return (
    await db.query<Followup>(
      "SELECT id,customer_id,last_message_id::text,due_at,variant,status FROM followups WHERE status='pending' ORDER BY due_at LIMIT 500",
    )
  ).rows;
}

export async function followupContext(db: Pick<pg.Pool, 'query'>, row: Followup) {
  const state = (
    await db.query(
      `SELECT c.mode,c.followup_refused,p.preferred_language,
    (SELECT id::text FROM chat_messages WHERE customer_id=c.customer_id AND role='user' ORDER BY id DESC LIMIT 1) AS latest_message,
    (SELECT revision FROM carts WHERE customer_id=c.customer_id) AS cart_revision,
    EXISTS (SELECT 1 FROM orders o JOIN chat_messages m ON m.id=$2::bigint WHERE o.customer_id=c.customer_id AND o.source='kenza' AND o.created_at>=m.created_at) AS ordered
    FROM conversations c JOIN customers p ON p.id=c.customer_id WHERE c.customer_id=$1`,
      [row.customer_id, row.last_message_id],
    )
  ).rows[0];
  const cart = await getCart(db, row.customer_id);
  const reason =
    !state || state.latest_message !== row.last_message_id
      ? 'new_message'
      : state.mode !== 'auto'
        ? 'human'
        : state.followup_refused
          ? 'refused'
          : state.ordered
            ? 'ordered'
            : !cart.length
              ? 'empty_cart'
              : cart.some((item) => item.stock < item.quantity)
                ? 'stock'
                : null;
  const history = (
    await db.query(
      'SELECT role,content FROM chat_messages WHERE customer_id=$1 ORDER BY id DESC LIMIT 12',
      [row.customer_id],
    )
  ).rows.reverse();
  return {
    reason,
    cartRevision: state?.cart_revision,
    language: state?.preferred_language,
    cart: cart.map(({ ref, model, size, color, quantity }) => ({
      ref,
      model,
      size,
      color,
      quantity,
    })),
    history,
    variant: row.variant,
  };
}

export async function followupReport(db: Pick<pg.Pool, 'query'>) {
  const rows = (
    await db.query(`SELECT f.id,f.customer_id,p.name,f.variant,f.status,f.reason,f.due_at,f.sent_at,f.response_at,f.order_id
    FROM followups f JOIN customers p ON p.id=f.customer_id ORDER BY f.created_at DESC LIMIT 100`)
  ).rows;
  const variants = (
    await db.query(`SELECT a.variant,count(DISTINCT a.customer_id)::int AS assigned,
    count(f.id) FILTER (WHERE f.status='pending')::int AS pending,
    count(f.id) FILTER (WHERE f.status='sent')::int AS sent,
    count(f.id) FILTER (WHERE f.status='cancelled')::int AS cancelled,
    count(f.id) FILTER (WHERE f.status='failed')::int AS failed,
    count(f.id) FILTER (WHERE f.response_at IS NOT NULL)::int AS responses,
    count(f.id) FILTER (WHERE f.order_id IS NOT NULL)::int AS orders
    FROM followup_assignments a LEFT JOIN followups f ON f.customer_id=a.customer_id
    GROUP BY a.variant ORDER BY a.variant`)
  ).rows;
  return { rows, variants, attributionHours: 24, experiment: 'abandon-v1' };
}
