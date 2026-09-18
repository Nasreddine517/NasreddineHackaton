import { useEffect, useRef, useState } from 'react';
import { chatApi } from './chat-api';
import type { ChatHistory } from './Chat';
type Summary = {
  customer_id: string;
  name: string;
  mode: string;
  last_message: string;
  open_escalations: number;
};
type Detail = ChatHistory & {
  customer: { name: string; city: string; preferred_language: string; followup_refused: boolean };
  cart: {
    ref: string;
    model: string;
    size: string;
    color: string;
    quantity: number;
    stock: number;
  }[];
  orders: { id: string; total_centimes: number; status: string }[];
  events: { agent: string; action: string; created_at: string }[];
  escalations: { id: string; reason: string; status: string; context: unknown }[];
};
type Metrics = {
  conversations: number;
  human_conversations: number;
  open_escalations: number;
  orders: number;
  sales_centimes: number;
  converted_customers: number;
  conversion_percent: number | null;
};
const money = (n: number) =>
  new Intl.NumberFormat('fr-MA', { style: 'currency', currency: 'MAD' }).format(n / 100);
const labels: Record<string, string> = {
  color: 'Couleur',
  size: 'Taille',
  style: 'Style',
  budget: 'Budget',
  language: 'Langue',
  discount_limit: 'Remise dépassant les droits de Kenza',
  invoice: 'Facturation société',
  complaint: 'Réclamation',
  dispute: 'Litige',
  cash_refund: 'Remboursement en espèces',
  outside_catalogue: 'Demande hors catalogue',
  unsupported_city: 'Ville non desservie',
  unknown_policy: 'Règle commerciale à préciser',
  CITY_REQUIRES_HUMAN: 'Ville non desservie',
  PROMOTION_REVIEW_REQUIRED: 'Promotion à vérifier',
  INVALID_PROMOTION: 'Promotion à vérifier',
  mode_changed: 'Mode de réponse modifié',
  message_sent: 'Réponse envoyée',
  escalations_resolved: 'Transferts clôturés',
  understand: 'Analyse de la demande',
  authorize: 'Vérification de l’action',
  approved: 'Action autorisée',
  blocked: 'Action bloquée',
  transferred: 'Transfert au commerçant',
  cart_updated: 'Panier modifié',
  quote_prepared: 'Devis préparé',
  compose: 'Préparation de la réponse',
  audit_answer: 'Vérification de la réponse',
  answer_validated: 'Réponse validée',
  answer_replaced: 'Réponse remplacée par prudence',
  turn_failed: 'Échec du traitement',
  search: 'Recherche catalogue',
  cart: 'Mise à jour du panier',
  checkout: 'Préparation du devis',
  chat: 'Conseil client',
};
export function MerchantConversations() {
  const [list, setList] = useState<Summary[]>([]),
    [selected, setSelected] = useState(''),
    [detail, setDetail] = useState<Detail | null>(null),
    [error, setError] = useState(''),
    [text, setText] = useState(''),
    [busy, setBusy] = useState(false),
    [metrics, setMetrics] = useState<Metrics | null>(null),
    [filter, setFilter] = useState('all');
  const pendingReply = useRef<{ customerId: string; message: string; id: string } | null>(null);
  const selection = useRef('');
  const currentFilter = useRef('all');
  const refreshVersion = useRef(0);
  async function refresh() {
    const version = ++refreshVersion.current;
    const customerId = selection.current,
      requestedFilter = currentFilter.current;
    const [summary, counters, conversation] = await Promise.all([
      chatApi<{ conversations: Summary[] }>(`/merchant/conversations?filter=${requestedFilter}`),
      chatApi<Metrics>('/merchant/metrics'),
      customerId
        ? chatApi<Detail>(`/merchant/conversations/${encodeURIComponent(customerId)}`)
        : Promise.resolve(null),
    ]);
    if (version !== refreshVersion.current) return;
    if (requestedFilter === currentFilter.current) setList(summary.conversations);
    setMetrics(counters);
    if (customerId === selection.current) setDetail(conversation);
  }
  async function act(fn: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Service indisponible.');
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void act(refresh);
    const timer = window.setInterval(() => {
      if (!document.hidden)
        void refresh().catch(() => setError('Actualisation indisponible. Réessayez.'));
    }, 10000);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <section className="supervision">
      {metrics && (
        <>
          <div className="merchant-metrics" aria-label="Activité de la boutique">
            <div>
              <span>Conversations clients</span>
              <strong>{metrics.conversations}</strong>
            </div>
            <div>
              <span>Commandes confirmées</span>
              <strong>{metrics.orders}</strong>
            </div>
            <div>
              <span>Montant des commandes</span>
              <strong>{money(metrics.sales_centimes)}</strong>
            </div>
            <div>
              <span>Conversion après échange</span>
              <strong>
                {metrics.conversion_percent === null ? '—' : `${metrics.conversion_percent} %`}
              </strong>
              <small>
                {metrics.converted_customers} client(s) sur {metrics.conversations}
              </small>
            </div>
            <div>
              <span>Transferts à traiter</span>
              <strong>{metrics.open_escalations}</strong>
              <small>{metrics.human_conversations} conversation(s) en reprise humaine</small>
            </div>
          </div>
          <p className="metric-explanation">
            Depuis le démarrage : commandes créées dans Kenza, hors historique importé. Le montant
            correspond aux commandes confirmées, pas aux encaissements. La conversion compte les
            clients ayant commandé après leur premier message ; elle ne prouve pas que Kenza a
            réalisé seule la vente.
          </p>
        </>
      )}
      <div className="merchant-toolbar">
        <h2>Conversations et transferts</h2>
        <label>
          Afficher
          <select
            value={filter}
            disabled={busy}
            onChange={(e) => {
              currentFilter.current = e.target.value;
              setFilter(e.target.value);
              void act(refresh);
            }}
          >
            <option value="all">Toutes les conversations</option>
            <option value="escalated">Transferts à traiter</option>
            <option value="human">Reprise humaine</option>
          </select>
        </label>
        <button disabled={busy} onClick={() => void act(refresh)}>
          Actualiser les échanges
        </button>
      </div>
      {error && (
        <p className="alert error" role="alert">
          {error}
        </p>
      )}
      <div className="supervision-grid">
        <nav aria-label="Conversations clients">
          {list.map((c) => (
            <button
              className={`conversation-choice ${selected === c.customer_id ? 'selected' : ''}`}
              key={c.customer_id}
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  setSelected(c.customer_id);
                  selection.current = c.customer_id;
                  setDetail(null);
                  setText('');
                  pendingReply.current = null;
                  await refresh();
                })
              }
            >
              <strong>{c.name}</strong>
              <span>
                {c.mode === 'human' ? 'Reprise humaine' : 'Kenza active'}
                {c.open_escalations > 0 ? ` · ${c.open_escalations} transfert(s)` : ''}
              </span>
              <small>{c.last_message}</small>
            </button>
          ))}
          {!list.length && <p>Aucune conversation dans cette vue.</p>}
        </nav>
        {detail && (
          <div className="panel">
            <h3>{detail.customer.name}</h3>
            <p>
              {detail.customer.city} · Langue : {detail.customer.preferred_language}
            </p>
            {detail.customer.followup_refused && (
              <p className="handoff-notice">Ce client a refusé les relances.</p>
            )}
            <div className="merchant-toolbar">
              <strong>
                {detail.mode === 'human'
                  ? 'Réponses automatiques suspendues'
                  : 'Kenza répond aux messages'}
              </strong>
              <button
                disabled={busy}
                onClick={() =>
                  void act(async () => {
                    await chatApi(
                      `/merchant/conversations/${encodeURIComponent(selected)}/control`,
                      { mode: detail.mode === 'human' ? 'auto' : 'human' },
                    );
                    await refresh();
                  })
                }
              >
                {detail.mode === 'human' ? 'Rendre la main à Kenza' : 'Prendre la main'}
              </button>
            </div>
            <div className="merchant-context">
              <details open>
                <summary>Panier actuel · {detail.cart.length} article(s)</summary>
                {detail.cart.length ? (
                  <ul>
                    {detail.cart.map((item) => (
                      <li key={item.ref}>
                        {item.model} · {item.ref} · {item.color} · {item.size} · Quantité{' '}
                        {item.quantity}
                        {item.stock < item.quantity && <strong> · Stock insuffisant</strong>}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>Le panier est vide.</p>
                )}
              </details>
              <details>
                <summary>Préférences mémorisées · {detail.memory.length}</summary>
                {detail.memory.length ? (
                  <ul>
                    {detail.memory.map((m) => (
                      <li key={m.key}>
                        {labels[m.key] ?? m.key} : {m.value}
                        <small>« {m.evidence} »</small>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>Aucune préférence enregistrée.</p>
                )}
              </details>
              <details>
                <summary>Dernières commandes Kenza · {detail.orders.length}</summary>
                {detail.orders.length ? (
                  <ul>
                    {detail.orders.map((o) => (
                      <li key={o.id}>
                        {o.id} · {money(o.total_centimes)} ·{' '}
                        {o.status === 'confirmed' ? 'Confirmée' : o.status}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>Aucune commande Kenza.</p>
                )}
              </details>
            </div>
            {detail.escalations
              .filter((e) => e.status === 'open')
              .map((e) => (
                <div key={e.id} className="handoff-notice">
                  Motif : {labels[e.reason] ?? e.reason}
                  <details>
                    <summary>Contexte complet transmis</summary>
                    <pre>{JSON.stringify(e.context, null, 2)}</pre>
                  </details>
                </div>
              ))}
            {detail.escalations.some((e) => e.status === 'open') && (
              <button
                disabled={busy}
                onClick={() =>
                  void act(async () => {
                    await chatApi(
                      `/merchant/conversations/${encodeURIComponent(selected)}/resolve`,
                      {},
                    );
                    await refresh();
                  })
                }
              >
                Clôturer les transferts sans changer le mode de réponse
              </button>
            )}
            <div className="chat-feed">
              {detail.messages.map((m) => (
                <article className={`chat-message ${m.role}`} key={m.id}>
                  <div className="message-author">
                    {m.role === 'user' ? 'Client' : m.role === 'merchant' ? 'Commerçant' : 'Kenza'}
                  </div>
                  <p dir="auto">{m.content}</p>
                </article>
              ))}
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void act(async () => {
                  const message = text.trim();
                  if (
                    !pendingReply.current ||
                    pendingReply.current.customerId !== selected ||
                    pendingReply.current.message !== message
                  )
                    pendingReply.current = {
                      customerId: selected,
                      message,
                      id: crypto.randomUUID(),
                    };
                  await chatApi(
                    `/merchant/conversations/${encodeURIComponent(selected)}/messages`,
                    { message, id: pendingReply.current.id },
                  );
                  pendingReply.current = null;
                  setText('');
                  await refresh();
                });
              }}
            >
              <label>
                Réponse du commerçant
                <textarea
                  value={text}
                  disabled={busy}
                  onChange={(e) => setText(e.target.value)}
                  required
                  maxLength={2000}
                />
              </label>
              <button disabled={busy || !text.trim()}>Répondre et prendre la main</button>
            </form>
            <details className="agent-traces">
              <summary>Journal des interventions</summary>
              <ol>
                {detail.events.map((e, i) => (
                  <li key={i}>
                    {e.agent === 'merchant' ? 'Commerçant' : e.agent} ·{' '}
                    {labels[e.action] ?? e.action} ·{' '}
                    {new Date(e.created_at).toLocaleString('fr-FR')}
                  </li>
                ))}
              </ol>
            </details>
          </div>
        )}
      </div>
    </section>
  );
}
