import { useEffect, useState } from 'react';
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
  events: { agent: string; action: string; created_at: string }[];
  escalations: { id: string; reason: string; status: string; context: unknown }[];
};
export function MerchantConversations() {
  const [list, setList] = useState<Summary[]>([]),
    [selected, setSelected] = useState(''),
    [detail, setDetail] = useState<Detail | null>(null),
    [error, setError] = useState(''),
    [text, setText] = useState(''),
    [busy, setBusy] = useState(false);
  async function refresh() {
    setList((await chatApi<{ conversations: Summary[] }>('/merchant/conversations')).conversations);
    if (selected)
      setDetail(await chatApi<Detail>(`/merchant/conversations/${encodeURIComponent(selected)}`));
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
  }, []);
  return (
    <section className="supervision">
      <div className="merchant-toolbar">
        <h2>Conversations et transferts</h2>
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
              onClick={() =>
                void act(async () => {
                  setSelected(c.customer_id);
                  setDetail(
                    await chatApi<Detail>(
                      `/merchant/conversations/${encodeURIComponent(c.customer_id)}`,
                    ),
                  );
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
          {!list.length && <p>Aucun échange pour le moment.</p>}
        </nav>
        {detail && (
          <div className="panel">
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
            {detail.escalations
              .filter((e) => e.status === 'open')
              .map((e) => (
                <div key={e.id} className="handoff-notice">
                  Motif : {e.reason}
                  <details>
                    <summary>Contexte complet transmis</summary>
                    <pre>{JSON.stringify(e.context, null, 2)}</pre>
                  </details>
                </div>
              ))}
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
                  await chatApi(
                    `/merchant/conversations/${encodeURIComponent(selected)}/messages`,
                    { message: text },
                  );
                  setText('');
                  await refresh();
                });
              }}
            >
              <label>
                Réponse du commerçant
                <textarea
                  value={text}
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
                    {e.agent} · {e.action} · {new Date(e.created_at).toLocaleTimeString('fr-FR')}
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
