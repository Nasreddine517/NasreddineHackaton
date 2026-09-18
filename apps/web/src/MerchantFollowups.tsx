import { useEffect, useState } from 'react';
import { chatApi } from './chat-api';

type Report = {
  variants: {
    variant: string;
    assigned: number;
    pending: number;
    sent: number;
    cancelled: number;
    failed: number;
    responses: number;
    orders: number;
  }[];
  rows: {
    id: string;
    name: string;
    variant: string;
    status: string;
    reason: string | null;
    due_at: string;
    sent_at: string | null;
    response_at: string | null;
    order_id: string | null;
  }[];
};
const statusLabels: Record<string, string> = {
  pending: 'Prévue',
  sent: 'Envoyée',
  cancelled: 'Annulée',
  failed: 'Échec technique',
};
const reasons: Record<string, string> = {
  new_message: 'Le client a répondu',
  human: 'Reprise humaine',
  refused: 'Refus du client',
  ordered: 'Commande confirmée',
  empty_cart: 'Panier vide',
  stock: 'Stock insuffisant',
  cart_changed: 'Panier modifié',
  guard: 'Réponse non validée',
  resolved: 'Demande résolue',
  inappropriate: 'Relance non pertinente',
  ineligible: 'Conditions non réunies',
  technical: 'Service indisponible',
};
export function MerchantFollowups() {
  const [report, setReport] = useState<Report | null>(null),
    [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    async function refresh() {
      try {
        const result = await chatApi<Report>('/merchant/followups');
        if (active) {
          setReport(result);
          setError('');
        }
      } catch {
        if (active) setError('Le suivi des relances est momentanément indisponible.');
      }
    }
    void refresh();
    const timer = setInterval(() => {
      if (!document.hidden) void refresh();
    }, 10000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  return (
    <section className="supervision">
      <h2>Relances et comparaison A/B</h2>
      <p className="metric-explanation">
        Une seule relance par abandon, prévue 30 minutes après le dernier message client. A propose
        de l’aide pour terminer le panier ; B pose une question sur le choix. Chaque client conserve
        sa variante.
      </p>
      {error && (
        <p role="alert" className="alert error">
          {error}
        </p>
      )}
      {report && (
        <>
          <div className="merchant-metrics">
            {['A', 'B'].map((variant) => {
              const stats = report.variants.find((v) => v.variant === variant);
              return (
                <div key={variant}>
                  <span>
                    Variante {variant} · {stats?.assigned ?? 0} client(s)
                  </span>
                  <strong>{stats?.sent ?? 0} envoi(s)</strong>
                  <span>
                    {stats?.responses ?? 0} réponse(s) · {stats?.orders ?? 0} commande(s)
                  </span>
                  <small>
                    {stats?.pending ?? 0} prévue(s) · {stats?.cancelled ?? 0} annulée(s) ·{' '}
                    {stats?.failed ?? 0} échec(s)
                  </small>
                </div>
              );
            })}
          </div>
          <p className="metric-explanation">
            Réponse et première commande attribuées à la dernière relance envoyée dans les 24 heures
            précédentes. Résultats observés, sans conclusion de supériorité statistique ni preuve de
            causalité.
          </p>
          <details>
            <summary>Historique des relances · 100 dernières au maximum</summary>
            {!report.rows.length ? (
              <p>Aucune relance programmée pour le moment.</p>
            ) : (
              <ul className="followup-list">
                {report.rows.map((row) => (
                  <li key={row.id}>
                    <strong>
                      {row.name} · {statusLabels[row.status] ?? row.status}
                    </strong>
                    <span>
                      Variante {row.variant} · Échéance :{' '}
                      {new Date(row.due_at).toLocaleString('fr-FR')}
                    </span>
                    {row.sent_at && (
                      <span>Envoyée : {new Date(row.sent_at).toLocaleString('fr-FR')}</span>
                    )}
                    {row.reason && reasons[row.reason] && <span>{reasons[row.reason]}</span>}
                    {row.response_at && <span>Le client a répondu.</span>}
                    {row.order_id && <span>Commande attribuée : {row.order_id}</span>}
                  </li>
                ))}
              </ul>
            )}
          </details>
        </>
      )}
    </section>
  );
}
