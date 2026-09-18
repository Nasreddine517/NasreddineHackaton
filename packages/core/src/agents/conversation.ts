import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
import { z } from 'zod';
import { BusinessError } from '../domain/pricing.js';
import { searchProducts, quoteDelivery } from '../domain/catalogue.js';
import { getCart, setCartItem, prepareCheckout } from '../domain/checkout.js';
import type { AgentModels, Plan, Guard } from './models.js';
import { safeModelFailure } from '../llm/clients.js';

type DB = pg.Pool;
type Context = {
  customerId: string;
  turnId: string;
  message: string;
  history: unknown[];
  memory: unknown[];
  cart: unknown[];
  cartRevision: number;
  customer: unknown;
  zones: unknown[];
  orders: unknown[];
};
export type Notify = (customerId: string, event: Record<string, unknown>) => void;
type Facts = Record<string, unknown>;
const State = Annotation.Root({
  context: Annotation<Context>(),
  plan: Annotation<Plan | null>(),
  guard: Annotation<Guard | null>(),
  facts: Annotation<Facts>(),
  draft: Annotation<string>(),
  reply: Annotation<string>(),
});
const fallback = (language = 'fr') =>
  language === 'fr'
    ? 'Je préfère vérifier plutôt que vous donner une information incertaine. Vous pouvez consulter les articles et votre panier ci-dessous, ou préciser votre demande.'
    : language === 'ar'
      ? 'أفضل التحقق قبل إعطائك معلومة غير مؤكدة. يمكنك مراجعة المنتجات والسلة أدناه أو توضيح طلبك.'
      : 'نفضل نتأكد باش ما نعطيكش معلومة غالطة. تقدر تشوف المنتجات والسلة لتحت، أو توضح ليا الطلب ديالك.';
const transferred = (language = 'fr') =>
  language === 'fr'
    ? 'J’ai transmis votre demande au commerçant avec le contexte de notre échange. Il pourra reprendre ici ; je ne peux pas vous promettre un délai de réponse.'
    : language === 'ar'
      ? 'أحلت طلبك إلى التاجر مع سياق المحادثة. يمكنه متابعة الحديث هنا، ولا أستطيع تحديد موعد للرد.'
      : 'وصلت الطلب ديالك للتاجر مع سياق الهضرة ديالنا. يقدر يكمل معاك هنا، ما نقدرش نوعدك بوقت الجواب.';

export async function withConversationLock<T>(db: DB, customerId: string, fn: (connection: pg.PoolClient) => Promise<T>) {
  const lock = await db.connect();
  let acquired = false;
  try {
    acquired = (
      await lock.query('SELECT pg_try_advisory_lock(7319, hashtext($1)) AS locked', [customerId])
    ).rows[0].locked;
    if (!acquired)
      throw new BusinessError(
        'CONVERSATION_BUSY',
        'Un message est déjà en cours de traitement. Réessayez dans un instant.',
      );
    return await fn(lock);
  } finally {
    try {
      if (acquired) await lock.query('SELECT pg_advisory_unlock(7319, hashtext($1))', [customerId]);
    } finally {
      lock.release();
    }
  }
}

export async function conversationHistory(db: DB, customerId: string) {
  const [conversation, messages, memory] = await Promise.all([
    db.query(
      'SELECT mode,last_client_message_at,followup_refused FROM conversations WHERE customer_id=$1',
      [customerId],
    ),
    db.query(
      `SELECT * FROM (SELECT id::text,role,content,metadata,created_at FROM chat_messages WHERE customer_id=$1 ORDER BY id DESC LIMIT 100) recent ORDER BY id::bigint`,
      [customerId],
    ),
    db.query('SELECT key,value,evidence FROM customer_memories WHERE customer_id=$1 ORDER BY key', [
      customerId,
    ]),
  ]);
  return {
    mode: conversation.rows[0]?.mode ?? 'auto',
    messages: messages.rows,
    memory: memory.rows,
  };
}

export async function createConversationService(
  db: DB,
  models: AgentModels,
  notify: Notify = () => {},
  checkpointSchema = 'public',
) {
  const saver = new PostgresSaver(db, undefined, { schema: checkpointSchema });
  // Prevent simultaneous API startups from racing the checkpointer's own migrations.
  const setup = await db.connect();
  try {
    await setup.query('SELECT pg_advisory_lock(7319001)');
    await saver.setup();
  } finally {
    await setup.query('SELECT pg_advisory_unlock(7319001)');
    setup.release();
  }

  async function event(ctx: Context, agent: string, action: string, details: unknown = {}) {
    await db.query(
      'INSERT INTO agent_events(customer_id,turn_id,agent,action,details) VALUES ($1,$2,$3,$4,$5)',
      [ctx.customerId, ctx.turnId, agent, action, JSON.stringify(details)],
    );
    notify(ctx.customerId, { type: 'agent.stage', agent, action });
  }
  async function escalate(ctx: Context, reason: string) {
    const transcript = (
      await db.query(
        'SELECT role,content,created_at FROM chat_messages WHERE customer_id=$1 ORDER BY id',
        [ctx.customerId],
      )
    ).rows;
    await db.query(
      `INSERT INTO escalations(id,customer_id,turn_id,reason,context) VALUES ($1,$2,$3,$4,$5) ON CONFLICT(turn_id) DO NOTHING`,
      [
        randomUUID(),
        ctx.customerId,
        ctx.turnId,
        reason,
        JSON.stringify({
          messages: transcript,
          cart: await getCart(db, ctx.customerId),
          memory: ctx.memory,
        }),
      ],
    );
    await db.query("UPDATE conversations SET mode='human',updated_at=now() WHERE customer_id=$1", [
      ctx.customerId,
    ]);
    await event(ctx, 'escalade', 'transferred', { reason });
    return { reply: transferred(), facts: { escalated: true, reason } };
  }

  const graph = new StateGraph(State)
    .addNode('conversation', async (state) => {
      await event(state.context, 'conversation', 'understand');
      return { plan: await models.plan(JSON.stringify(state.context)) };
    })
    .addNode('garde_fou_action', async (state) => {
      await event(state.context, 'garde_fou', 'authorize');
      const guard = await models.authorize(
        JSON.stringify({ context: state.context, plan: state.plan }),
      );
      await event(state.context, 'garde_fou', guard.approved ? 'approved' : 'blocked', {
        escalation: guard.escalation,
      });
      return { guard };
    })
    .addNode('escalade', async (state) => {
      const result = await escalate(
        state.context,
        state.guard?.escalation !== 'none' ? state.guard!.escalation : state.plan!.escalation,
      );
      return { ...result, reply: transferred(state.plan?.language) };
    })
    .addNode('catalogue', async (state) => {
      const { context: ctx, plan, guard } = state;
      if (!plan || !guard?.approved) return { facts: { action: 'clarify', performed: false } };
      await event(ctx, 'catalogue', plan.intent);
      const facts: Facts = { action: plan.intent };
      try {
        if (plan.intent === 'search') {
          facts.products = await searchProducts(db, {
            query: plan.query ?? '',
            color: plan.color ?? undefined,
            size: plan.size ?? undefined,
            material: plan.material ?? undefined,
            maxPriceCentimes: plan.maxPriceCentimes ?? undefined,
            limit: 8,
          });
          if (plan.city)
            facts.delivery = await quoteDelivery(
              db,
              plan.city,
              plan.method ?? 'delivery',
              plan.payment === 'cash_on_delivery',
            );
        }
        if (plan.intent === 'cart') {
          if (!plan.ref || plan.quantity === null)
            throw new BusinessError('CLARIFY_ITEM', 'Précisez l’article et la quantité souhaités.');
          // A reference must come from a previously shown product/cart or the client's literal request.
          const visible = JSON.stringify({ history: ctx.history, cart: ctx.cart });
          if (!ctx.message.includes(plan.ref) && !visible.includes(`"${plan.ref}"`))
            throw new BusinessError(
              'CLARIFY_ITEM',
              'Choisissez une référence parmi les articles présentés.',
            );
          facts.cart = await setCartItem(db, ctx.customerId, {
            ref: plan.ref,
            quantity: plan.quantity,
          },ctx.cartRevision);
          facts.performed = true;
          await event(ctx, 'catalogue', 'cart_updated', { ref: plan.ref, quantity: plan.quantity });
        }
        if (plan.intent === 'checkout') {
          if (
            !plan.city ||
            !plan.method ||
            !plan.payment ||
            (plan.method === 'delivery' && !plan.address)
          )
            throw new BusinessError(
              'CLARIFY_DELIVERY',
              'Précisez la ville, la réception, le paiement et l’adresse de livraison.',
            );
          facts.quote = await prepareCheckout(db, ctx.customerId, {
            city: plan.city,
            method: plan.method,
            payment: plan.payment,
            address: plan.address ?? '',
          });
          facts.requiresButtonConfirmation = true;
          await event(ctx, 'catalogue', 'quote_prepared');
        }
        if (plan.intent === 'chat' && plan.city)
          facts.delivery = await quoteDelivery(
            db,
            plan.city,
            plan.method ?? 'delivery',
            plan.payment === 'cash_on_delivery',
          );
        for (const memory of plan.memories) {
          if (!ctx.message.includes(memory.evidence)) continue;
          await db.query(
            `INSERT INTO customer_memories(customer_id,key,value,evidence) VALUES ($1,$2,$3,$4)
            ON CONFLICT(customer_id,key) DO UPDATE SET value=excluded.value,evidence=excluded.evidence,updated_at=now()`,
            [ctx.customerId, memory.key, memory.value, memory.evidence],
          );
        }
        if (plan.refuseFollowup)
          await db.query('UPDATE conversations SET followup_refused=true WHERE customer_id=$1', [
            ctx.customerId,
          ]);
      } catch (e) {
        if (!(e instanceof BusinessError)) throw e;
        facts.error = { code: e.code, message: e.message };
        if (
          ['CITY_REQUIRES_HUMAN', 'PROMOTION_REVIEW_REQUIRED', 'INVALID_PROMOTION'].includes(e.code)
        ) {
          const handoff = await escalate(ctx, e.code);
          return { ...handoff, reply: transferred(plan.language) };
        }
      }
      return { facts };
    })
    .addNode('redaction', async (state) => {
      await event(state.context, 'conversation', 'compose');
      return {
        draft: await models.respond(
          JSON.stringify({
            context: state.context,
            plan: state.plan,
            guard: state.guard,
            facts: state.facts,
          }),
        ),
      };
    })
    .addNode('garde_fou_reponse', async (state) => {
      await event(state.context, 'garde_fou', 'audit_answer');
      const safe = await models.audit(
        JSON.stringify({
          context: state.context,
          plan: state.plan,
          facts: state.facts,
          answer: state.draft,
        }),
      );
      await event(state.context, 'garde_fou', safe ? 'answer_validated' : 'answer_replaced');
      return { reply: safe ? state.draft : fallback(state.plan?.language) };
    })
    .addEdge(START, 'conversation')
    .addEdge('conversation', 'garde_fou_action')
    .addConditionalEdges(
      'garde_fou_action',
      (s) =>
        s.guard?.escalation !== 'none' ||
        s.plan?.escalation !== 'none' ||
        s.plan?.intent === 'escalate'
          ? 'escalade'
          : 'catalogue',
      ['escalade', 'catalogue'],
    )
    .addEdge('escalade', END)
    .addConditionalEdges('catalogue', (s) => (s.facts.escalated ? END : 'redaction'), [
      END,
      'redaction',
    ])
    .addEdge('redaction', 'garde_fou_reponse')
    .addEdge('garde_fou_reponse', END)
    .compile({ checkpointer: saver });

  let active = 0;
  async function send(customerId: string, input: unknown) {
    const data = z
      .object({ id: z.string().uuid(), message: z.string().trim().min(1).max(2000) })
      .strict()
      .parse(input);
    if (active >= 3)
      throw new BusinessError(
        'SERVICE_BUSY',
        'Kenza traite plusieurs demandes. Réessayez dans un instant.',
      );
    active++;
    try {
      return await withConversationLock(db, customerId, async (connection) => {
        await db.query(
          'INSERT INTO conversations(customer_id) VALUES ($1) ON CONFLICT DO NOTHING',
          [customerId],
        );
        const existing = (
          await db.query('SELECT customer_id,input,status FROM chat_turns WHERE id=$1', [data.id])
        ).rows[0];
        if (existing) {
          if (existing.customer_id !== customerId || existing.input !== data.message)
            throw new BusinessError(
              'MESSAGE_CONFLICT',
              'Cet identifiant de message est déjà utilisé.',
            );
          if (existing.status === 'processing') {
            // The advisory lock is free: the previous process was interrupted. Never replay its writes.
            await db.query("UPDATE chat_turns SET status='failed' WHERE id=$1", [data.id]);
            await db.query(
              `INSERT INTO chat_messages(customer_id,turn_id,role,content) VALUES ($1,$2,'assistant',$3) ON CONFLICT DO NOTHING`,
              [
                customerId,
                data.id,
                'Le traitement précédent a été interrompu. Vérifiez votre panier avant de reformuler votre demande.',
              ],
            );
          }
          return conversationHistory(db, customerId);
        }
        await connection.query('BEGIN');
        try {
          await connection.query("INSERT INTO chat_turns(id,customer_id,input,status) VALUES ($1,$2,$3,'processing')",[data.id,customerId,data.message]);
          await connection.query("INSERT INTO chat_messages(customer_id,turn_id,role,content) VALUES ($1,$2,'user',$3)",[customerId,data.id,data.message]);
          await connection.query('UPDATE conversations SET last_client_message_at=now(),updated_at=now() WHERE customer_id=$1',[customerId]);
          await connection.query('COMMIT');
        } catch(error) { await connection.query('ROLLBACK'); throw error; }
        notify(customerId, { type: 'conversation.updated' });
        let reply = '',
          metadata: Facts = {},
          status = 'completed';
        try {
          const history = await conversationHistory(db, customerId);
          if (history.mode === 'human') {
            await db.query("UPDATE chat_turns SET status='completed' WHERE id=$1", [data.id]);
            notify(customerId, { type: 'conversation.updated' });
            return conversationHistory(db, customerId);
          }
          const cartRevision=(await db.query('SELECT revision FROM carts WHERE customer_id=$1',[customerId])).rows[0]?.revision ?? 0;
          const context: Context = {
            customerId,
            turnId: data.id,
            message: data.message,
            history: history.messages.slice(-25),
            memory: history.memory,
            cart: await getCart(db, customerId),
            cartRevision,
            customer: (
              await db.query('SELECT name,city,preferred_language FROM customers WHERE id=$1', [
                customerId,
              ])
            ).rows[0],
            zones: (
              await db.query(
                'SELECT city,fee_centimes,delay_hours,cash_on_delivery,pickup FROM delivery_zones',
              )
            ).rows,
            orders: (
              await db.query(
                'SELECT id,status,total_centimes,created_at FROM orders WHERE customer_id=$1 ORDER BY created_at DESC LIMIT 5',
                [customerId],
              )
            ).rows,
          };
          const result = await graph.invoke(
            { context, plan: null, guard: null, facts: {}, draft: '', reply: '' },
            { configurable: { thread_id: customerId }, recursionLimit: 12 },
          );
          reply = result.reply;
          metadata = result.facts;
        } catch (error) {
          status = 'failed';
          // Never return upstream error bodies, headers, prompts or secrets.
          reply =
            'Je rencontre une difficulté technique. Vérifiez votre panier avant de réessayer ; aucune commande ne peut être confirmée par ce message.';
          await db.query(
            "INSERT INTO agent_events(customer_id,turn_id,agent,action,details) VALUES ($1,$2,'system','turn_failed',$3)",
            [customerId, data.id, JSON.stringify(safeModelFailure(error))],
          );
        }
        await db.query(
          "INSERT INTO chat_messages(customer_id,turn_id,role,content,metadata) VALUES ($1,$2,'assistant',$3,$4) ON CONFLICT DO NOTHING",
          [customerId, data.id, reply, JSON.stringify(metadata)],
        );
        await db.query('UPDATE chat_turns SET status=$2 WHERE id=$1', [data.id, status]);
        notify(customerId, { type: 'conversation.updated' });
        return conversationHistory(db, customerId);
      });
    } finally {
      active--;
    }
  }
  return { send, history: (id: string) => conversationHistory(db, id), graph };
}
export type ConversationService = Awaited<ReturnType<typeof createConversationService>>;
