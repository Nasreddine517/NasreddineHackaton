import type pg from 'pg';
import { withConversationLock } from '../agents/conversation.js';
import { BusinessError } from './pricing.js';

// All-time cohort: customers with a real client message. Historical orders and
// purchases preceding the first message never count as conversational conversions.
export async function merchantMetrics(db: Pick<pg.Pool, 'query'>) {
  const { rows } = await db.query(`WITH cohort AS (
    SELECT customer_id,min(created_at) AS first_message FROM chat_messages
    WHERE role='user' GROUP BY customer_id
  ), sales AS (
    SELECT * FROM orders WHERE source='kenza' AND status='confirmed'
  ) SELECT
    (SELECT count(*)::int FROM cohort) AS conversations,
    (SELECT count(*)::int FROM conversations WHERE mode='human') AS human_conversations,
    (SELECT count(*)::int FROM escalations WHERE status='open') AS open_escalations,
    (SELECT count(*)::int FROM sales) AS orders,
    (SELECT coalesce(sum(total_centimes),0)::text FROM sales) AS sales_centimes,
    (SELECT count(*)::int FROM cohort c WHERE EXISTS (
      SELECT 1 FROM sales o WHERE o.customer_id=c.customer_id AND o.created_at>=c.first_message
    )) AS converted_customers`);
  const row = rows[0];
  return {
    ...row,
    sales_centimes: Number(row.sales_centimes),
    conversion_percent: row.conversations
      ? Math.round((row.converted_customers * 10000) / row.conversations) / 100
      : null,
  };
}

export async function updateSupervision(
  db: pg.Pool,
  customerId: string,
  action: { mode: 'auto' | 'human' } | { message: string; id: string } | { resolve: true },
) {
  return withConversationLock(db, customerId, async (connection) => {
    await connection.query('BEGIN');
    try {
      const current = (
        await connection.query('SELECT mode FROM conversations WHERE customer_id=$1 FOR UPDATE', [
          customerId,
        ])
      ).rows[0];
      if (!current) throw Object.assign(new Error('Conversation not found'), { statusCode: 404 });
      if ('message' in action) {
        const previous = (
          await connection.query(
            'SELECT customer_id,content FROM chat_messages WHERE merchant_request_id=$1',
            [action.id],
          )
        ).rows[0];
        if (previous) {
          if (previous.customer_id !== customerId || previous.content !== action.message)
            throw new BusinessError(
              'MESSAGE_CONFLICT',
              'Cet identifiant de message est déjà utilisé.',
            );
          await connection.query('COMMIT');
          return;
        }
        await connection.query(
          "INSERT INTO chat_messages(customer_id,role,content,merchant_request_id) VALUES ($1,'merchant',$2,$3)",
          [customerId, action.message, action.id],
        );
      }
      const mode = 'mode' in action ? action.mode : 'message' in action ? 'human' : current.mode;
      await connection.query(
        'UPDATE conversations SET mode=$2,updated_at=now() WHERE customer_id=$1',
        [customerId, mode],
      );
      if (mode === 'auto' || 'resolve' in action)
        await connection.query(
          "UPDATE escalations SET status='resolved' WHERE customer_id=$1 AND status='open'",
          [customerId],
        );
      await connection.query(
        "INSERT INTO agent_events(customer_id,agent,action,details) VALUES ($1,'merchant',$2,$3)",
        [
          customerId,
          'message' in action
            ? 'message_sent'
            : 'resolve' in action
              ? 'escalations_resolved'
              : 'mode_changed',
          JSON.stringify({ mode }),
        ],
      );
      await connection.query('COMMIT');
    } catch (error) {
      await connection.query('ROLLBACK');
      throw error;
    }
  });
}
