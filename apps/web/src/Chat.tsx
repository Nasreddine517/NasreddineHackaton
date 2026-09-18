import { useEffect, useRef, useState } from 'react';
import { MessageCircle, Send, ShieldCheck } from 'lucide-react';
import type { Product } from '../../../packages/core/src/domain/catalogue.js';
import type { CheckoutSnapshot } from '../../../packages/core/src/domain/checkout.js';
import { chatApi } from './chat-api';
type Quote = CheckoutSnapshot & { id: string; expiresAt: string };
export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant' | 'merchant';
  content: string;
  created_at: string;
  metadata: {
    products?: Product[];
    quote?: Quote;
    error?: { message: string };
    escalated?: boolean;
  };
};
export type ChatHistory = {
  mode: 'auto' | 'human';
  messages: ChatMessage[];
  memory: { key: string; value: string; evidence: string }[];
};
const money = (n: number) =>
  new Intl.NumberFormat('fr-MA', { style: 'currency', currency: 'MAD' }).format(n / 100);
const stages: Record<string, string> = {
  conversation: 'Je prépare votre réponse…',
  catalogue: 'Je consulte la boutique…',
  garde_fou: 'Je vérifie les informations…',
  escalade: 'Je prépare le transfert au commerçant…',
};

export function Chat({
  customerId,
  onChanged,
  onAdd,
}: {
  customerId: string;
  onChanged: () => Promise<void>;
  onAdd: (ref: string) => Promise<void>;
}) {
  const [history, setHistory] = useState<ChatHistory>({ mode: 'auto', messages: [], memory: [] });
  const [text, setText] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [stage, setStage] = useState(''),
    [enabled, setEnabled] = useState(false),
    [online, setOnline] = useState(false);
  const [confirmed, setConfirmed] = useState<Record<string, string>>({});
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [history.messages.length, stage]);
  useEffect(() => {
    let active = true,
      socket: WebSocket | undefined,
      retry: ReturnType<typeof setTimeout> | undefined;
    const refresh = () =>
      chatApi<ChatHistory>('/client/conversation')
        .then((h) => {
          if (active) setHistory(h);
        })
        .catch(() => {});
    function connect() {
      if (!active) return;
      socket = new WebSocket(
        `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/api/client/events`,
      );
      socket.onmessage = (e) => {
        if (!active) return;
        try {
          const event = JSON.parse(e.data);
          if (event.type === 'connected') {
            setOnline(true);
            void refresh();
          }
          if (event.type === 'agent.stage')
            setStage(stages[event.agent] ?? 'Je vérifie votre demande…');
          if (event.type === 'conversation.updated') {
            setStage('');
            void refresh();
          }
        } catch {}
      };
      socket.onerror = () => socket?.close();
      socket.onclose = () => {
        if (active) {
          setOnline(false);
          retry = setTimeout(connect, 3000);
        }
      };
    }
    void chatApi<{ chatEnabled: boolean }>('/system').then((s) => {
      if (active) {
        setEnabled(s.chatEnabled);
        if (s.chatEnabled) {
          void refresh();
          connect();
        }
      }
    });
    return () => {
      active = false;
      if (retry) clearTimeout(retry);
      socket?.close();
    };
  }, [customerId]);
  async function send() {
    if (!text.trim() || busy) return;
    setBusy(true);
    setError('');
    setStage('Je vous écoute…');
    const key = `kenza-pending-${customerId}`;
    let pending: { id: string; message: string } | null = null;
    try {
      pending = JSON.parse(sessionStorage.getItem(key) ?? 'null');
    } catch {}
    if (pending?.message !== text.trim())
      pending = { id: crypto.randomUUID(), message: text.trim() };
    sessionStorage.setItem(key, JSON.stringify(pending));
    try {
      setHistory(await chatApi<ChatHistory>('/client/messages', pending));
      sessionStorage.removeItem(key);
      setText('');
      await onChanged();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Connexion interrompue. Réessayez le même message.',
      );
    } finally {
      setBusy(false);
      setStage('');
    }
  }
  async function confirm(quote: Quote) {
    setBusy(true);
    setError('');
    try {
      const result = await chatApi<{ orderId: string }>('/client/checkout/confirm', {
        quoteId: quote.id,
        confirmed: true,
      });
      setConfirmed((prev) => ({ ...prev, [quote.id]: result.orderId }));
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Confirmation indisponible.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="chat panel" aria-label="Conversation avec Kenza">
      <div className="chat-heading">
        <span className="avatar">k.</span>
        <div>
          <h2>Kenza, à votre écoute</h2>
          <span>
            {history.mode === 'human'
              ? 'Le commerçant prend le relais'
              : online
                ? 'Français · العربية · Darija'
                : 'Connexion en cours…'}
          </span>
        </div>
        <MessageCircle size={22} />
      </div>
      {!enabled ? (
        <p>La conversation sera disponible lorsque les modèles seront connectés.</p>
      ) : (
        <>
          {history.memory.length > 0 && (
            <details className="memory">
              <summary>Ce que je retiens de vos préférences</summary>
              <ul>
                {history.memory.map((m) => (
                  <li key={m.key} dir="auto">
                    {m.value}
                  </li>
                ))}
              </ul>
            </details>
          )}
          <div className="chat-feed" role="log" aria-label="Messages" aria-live="polite">
            {!history.messages.length && (
              <div className="chat-empty">
                <h3>Salam, bienvenue chez nous.</h3>
                <p>
                  Décrivez ce que vous cherchez, votre style ou l’occasion. Je consulte les articles
                  de la boutique pour vous conseiller.
                </p>
                <div className="suggestions">
                  {[
                    'Je cherche une robe bleue',
                    'Chno kayn f les sacs ?',
                    'بغيت نعرف التوصيل لفاس',
                  ].map((s) => (
                    <button key={s} className="text-button" onClick={() => setText(s)}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {history.messages.map((m) => (
              <article key={m.id} className={`chat-message ${m.role}`}>
                <div className="message-author">
                  {m.role === 'user' ? 'Vous' : m.role === 'merchant' ? 'Le commerçant' : 'Kenza'}
                  <time>
                    {new Date(m.created_at).toLocaleTimeString('fr-FR', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </time>
                </div>
                <p dir="auto">{m.content}</p>
                {!!m.metadata.products?.length && (
                  <div className="chat-products">
                    {m.metadata.products.map((p) => (
                      <div className="chat-product" key={p.ref}>
                        <strong>{p.model}</strong>
                        <span>
                          {p.color} · {p.size} · {p.ref}
                        </span>
                        <b>{money(p.promotion?.priceCentimes ?? p.priceCentimes)}</b>
                        <button disabled={busy} onClick={() => void onAdd(p.ref)}>
                          Ajouter {p.ref}
                        </button>
                      </div>
                    ))}
                    <small>Prix et stock vérifiés à nouveau avant la commande.</small>
                  </div>
                )}
                {m.metadata.quote && (
                  <div className="chat-quote">
                    <h3>Votre récapitulatif</h3>
                    {m.metadata.quote.lines.map((l) => (
                      <p key={l.ref}>
                        {l.quantity} × {l.model} · {l.size}
                        <b>{money(l.unitCentimes * l.quantity)}</b>
                      </p>
                    ))}
                    <p>
                      {m.metadata.quote.delivery.method === 'pickup' ? 'Retrait' : 'Livraison'} ·{' '}
                      {m.metadata.quote.delivery.city}
                      <b>{money(m.metadata.quote.delivery.feeCentimes)}</b>
                    </p>
                    <p>Délai indiqué : {m.metadata.quote.delivery.delayHours} h</p>
                    <p>
                      <strong>Total</strong>
                      <b>{money(m.metadata.quote.totalCentimes)}</b>
                    </p>
                    <small>Aucun paiement encaissé. Récapitulatif valable dix minutes.</small>
                    {confirmed[m.metadata.quote.id] ? (
                      <p role="status">Commande confirmée : {confirmed[m.metadata.quote.id]}</p>
                    ) : (
                      <button disabled={busy} onClick={() => void confirm(m.metadata.quote!)}>
                        Confirmer cette commande · {money(m.metadata.quote.totalCentimes)}
                      </button>
                    )}
                  </div>
                )}
              </article>
            ))}
            {stage && (
              <p className="chat-stage" role="status">
                <span />
                {stage}
              </p>
            )}
            <div ref={end} />
          </div>
          {history.mode === 'human' && (
            <p className="handoff-notice">
              <ShieldCheck size={16} /> Votre échange est transmis. Les réponses automatiques sont
              suspendues ; vous pouvez compléter votre demande.
            </p>
          )}
          {error && (
            <p className="alert error" role="alert">
              {error}
            </p>
          )}
          <form
            className="chat-composer"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <label className="grow">
              Votre message
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                dir="auto"
                placeholder="Écrivez à Kenza…"
                maxLength={2000}
                required
                disabled={busy}
              />
            </label>
            <button disabled={busy || !text.trim()} aria-label="Envoyer le message">
              <Send size={18} />
              <span>Envoyer</span>
            </button>
          </form>
        </>
      )}
    </section>
  );
}
