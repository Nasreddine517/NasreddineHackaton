import type pg from 'pg';
import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import { followupContext, type Followup } from '../domain/followups.js';
import { withConversationLock } from './conversation.js';
import { followupDecisionSchema, type FollowupDecision, type FollowupModels } from './models.js';

const State = Annotation.Root({
  context: Annotation<string>(),
  decision: Annotation<FollowupDecision | null>(),
  safe: Annotation<boolean>(),
});

export function createFollowupService(db: pg.Pool, models: FollowupModels) {
  const graph = new StateGraph(State)
    .addNode('relance', async (state) => ({
      decision: followupDecisionSchema.parse(await models.decide(state.context)),
    }))
    .addNode('garde_fou', async (state) => ({
      safe:
        Boolean(state.decision?.message.trim()) &&
        state.decision?.reason === 'helpful' &&
        (await models.audit(
          JSON.stringify({
            context: JSON.parse(state.context),
            answer: state.decision?.message,
            action: 'followup',
          }),
        )),
    }))
    .addEdge(START, 'relance')
    .addConditionalEdges('relance', (state) => (state.decision?.eligible ? 'garde_fou' : END), [
      'garde_fou',
      END,
    ])
    .addEdge('garde_fou', END)
    .compile();

  async function process(id: string, now = new Date()) {
    const row = (
      await db.query<Followup>(
        'SELECT id,customer_id,last_message_id::text,due_at,variant,status FROM followups WHERE id=$1',
        [id],
      )
    ).rows[0];
    if (!row || row.status !== 'pending') return null;
    if (row.due_at > now) throw new Error('FOLLOWUP_NOT_DUE');
    const context = await followupContext(db, row);
    if (context.reason) {
      await db.query(
        "UPDATE followups SET status='cancelled',reason=$2 WHERE id=$1 AND status='pending'",
        [id, context.reason],
      );
      return null;
    }
    // LLM calls deliberately run outside the conversation lock: a new message
    // or a human can take over immediately while this draft is being generated.
    const result = await graph.invoke({
      context: JSON.stringify(context),
      decision: null,
      safe: false,
    });
    return withConversationLock(db, row.customer_id, async (connection) => {
      await connection.query('BEGIN');
      try {
        // Match checkout's lock order. An order or cart change cannot slip
        // between the final eligibility check and committing the chat message.
        await connection.query('SELECT revision FROM carts WHERE customer_id=$1 FOR UPDATE', [
          row.customer_id,
        ]);
        await connection.query(
          `SELECT p.ref FROM products p JOIN cart_items i ON i.product_ref=p.ref
          WHERE i.customer_id=$1 ORDER BY p.ref FOR SHARE OF p`,
          [row.customer_id],
        );
        const locked = (
          await connection.query('SELECT status FROM followups WHERE id=$1 FOR UPDATE', [id])
        ).rows[0];
        if (locked?.status !== 'pending') {
          await connection.query('COMMIT');
          return null;
        }
        const fresh = await followupContext(connection, row);
        const reason =
          fresh.reason ??
          (fresh.cartRevision !== context.cartRevision
            ? 'cart_changed'
            : !result.decision?.eligible
              ? (result.decision?.reason ?? 'inappropriate')
              : !result.safe
                ? 'guard'
                : null);
        if (reason) {
          await connection.query("UPDATE followups SET status='cancelled',reason=$2 WHERE id=$1", [
            id,
            reason,
          ]);
          if (reason === 'refused')
            await connection.query(
              'UPDATE conversations SET followup_refused=true WHERE customer_id=$1',
              [row.customer_id],
            );
        } else {
          const message = (
            await connection.query(
              `INSERT INTO chat_messages(customer_id,role,content,metadata)
            VALUES ($1,'assistant',$2,$3) RETURNING id`,
              [
                row.customer_id,
                result.decision!.message.trim(),
                JSON.stringify({ followupId: id, variant: row.variant }),
              ],
            )
          ).rows[0];
          await connection.query(
            "UPDATE followups SET status='sent',sent_at=clock_timestamp(),message_id=$2,reason='helpful' WHERE id=$1",
            [id, message.id],
          );
          await connection.query('UPDATE conversations SET updated_at=now() WHERE customer_id=$1', [
            row.customer_id,
          ]);
        }
        await connection.query(
          "INSERT INTO agent_events(customer_id,agent,action,details) VALUES ($1,'relance',$2,$3)",
          [
            row.customer_id,
            reason ? 'followup_cancelled' : 'followup_sent',
            JSON.stringify({ followupId: id, variant: row.variant, reason }),
          ],
        );
        await connection.query('COMMIT');
        return reason ? null : row.customer_id;
      } catch (error) {
        await connection.query('ROLLBACK');
        throw error;
      }
    });
  }
  return { process, graph };
}
